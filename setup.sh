#!/bin/bash
# =============================================================================
# ERP DataProtect — Setup IA Stack (Linux / Mac / WSL2)
# =============================================================================
# A executer UNE FOIS apres le premier "docker-compose up -d".
# Prerequis : docker-compose up -d deja lance et tous les services UP.
#
# Ce script :
#   1. Copie le modele Mistral (.gguf 4.3 Go) dans le conteneur Ollama
#   2. Cree le modele "erp-dataprotect" dans Ollama via le Modelfile
#   3. Vectorise erp_documentation.json dans ChromaDB via un conteneur Python
#   4. Verifie le resultat final
#
# Duree estimee : 15-30 min (copie .gguf + import ollama + telechargement
#                             sentence-transformers + vectorisation)
# =============================================================================

set -e

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
GGUF_FILE="chatbot-finetuning/mistral-7b-instruct-v0.3.Q4_K_M.gguf"
MODELFILE="chatbot-finetuning/Modelfile"

cd "$REPO_ROOT"

echo ""
echo "============================================================"
echo "  ERP DataProtect — Initialisation de la Stack IA"
echo "============================================================"
echo ""

# ------ Verification des prerequis ----------------------------------------
echo "[0/3] Verification des prerequis..."

if ! docker ps --format '{{.Names}}' | grep -q "^erp-ollama$"; then
  echo "ERREUR : Le conteneur erp-ollama n'est pas demarre."
  echo "Lancez d'abord : docker-compose up -d"
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -q "^erp-chromadb$"; then
  echo "ERREUR : Le conteneur erp-chromadb n'est pas demarre."
  echo "Lancez d'abord : docker-compose up -d"
  exit 1
fi

if [ ! -f "$GGUF_FILE" ]; then
  echo "ERREUR : Fichier introuvable : $GGUF_FILE"
  echo "Verifiez que le fichier .gguf est present (git lfs pull si besoin)."
  exit 1
fi

GGUF_SIZE=$(du -h "$GGUF_FILE" | cut -f1)
echo "  OK — erp-ollama : demarre"
echo "  OK — erp-chromadb : demarre"
echo "  OK — $GGUF_FILE ($GGUF_SIZE)"
echo ""

# ------ Etape 1 : Import modele dans Ollama --------------------------------
echo "[1/3] Import du modele Mistral dans Ollama..."
echo "      Copie de $GGUF_SIZE vers le conteneur (peut prendre 2-5 min)..."

docker cp "$GGUF_FILE" erp-ollama:/tmp/mistral-7b-instruct-v0.3.Q4_K_M.gguf
docker cp "$MODELFILE" erp-ollama:/tmp/Modelfile

echo "      Creation du modele erp-dataprotect (peut prendre 5-15 min)..."
docker exec erp-ollama ollama create erp-dataprotect -f /tmp/Modelfile

echo ""
echo "      Modeles disponibles dans Ollama :"
docker exec erp-ollama ollama list
echo ""

# ------ Etape 2 : Vectorisation ChromaDB -----------------------------------
echo "[2/3] Vectorisation de la documentation ERP dans ChromaDB..."
echo "      Telechargement de sentence-transformers (~100 Mo la premiere fois)"
echo "      puis indexation des 35 documents..."
echo ""

# Detecter le reseau Docker du conteneur chromadb
NETWORK=$(docker inspect erp-chromadb \
  --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' \
  | tr ' ' '\n' | grep -v '^$' | head -1)

echo "      Reseau Docker detecte : $NETWORK"

docker run --rm \
  -v "${REPO_ROOT}/chatbot-rag:/app" \
  -w /app \
  --network "$NETWORK" \
  -e CHROMADB_HOST=erp-chromadb \
  python:3.11-slim \
  sh -c "pip install 'chromadb>=1.0.0' 'sentence-transformers>=2.0.0' --quiet && python vectorize_docs.py"

echo ""

# ------ Etape 3 : Verification --------------------------------------------
echo "[3/3] Verification finale..."
echo ""

echo "  Collections ChromaDB :"
COLS=$(curl -sf "http://localhost:8000/api/v2/tenants/default_tenant/databases/default_database/collections" 2>/dev/null || echo "[]")
echo "  $COLS"
echo ""

echo "  Modeles Ollama :"
docker exec erp-ollama ollama list
echo ""

echo "============================================================"
echo "  Setup termine !"
echo "============================================================"
echo ""
echo "  Redemarrez le conteneur chatbot pour recharger la connexion"
echo "  ChromaDB/Ollama etablie au demarrage :"
echo ""
echo "    docker restart erp-chatbot"
echo ""
echo "  Test rapide :"
echo "    curl -s http://localhost:3500/health"
echo "    curl -s -X POST http://localhost:3500/chat \\"
echo "      -H 'Content-Type: application/json' \\"
echo "      -H 'Authorization: Bearer <JWT>' \\"
echo "      -d '{\"message\":\"Comment creer un ticket helpdesk ?\",\"conversationId\":\"test\"}'"
echo ""
