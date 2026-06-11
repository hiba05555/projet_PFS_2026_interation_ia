"""
Script de vectorisation de la documentation ERP pour RAG
========================================================

Ce script charge la documentation ERP depuis erp_documentation.json
et la vectorise dans ChromaDB pour la recherche sémantique.

Prérequis:
- ChromaDB installé: pip install chromadb
- sentence-transformers installé: pip install sentence-transformers
- ChromaDB container qui tourne (port 8000)
"""

import json
import chromadb
from chromadb.config import Settings
from sentence_transformers import SentenceTransformer
import time

print("🔄 Initialisation du script de vectorisation RAG...\n")

# ============================================================================
# CONFIGURATION
# ============================================================================

# ChromaDB connection
CHROMADB_HOST = "localhost"
CHROMADB_PORT = 8000
COLLECTION_NAME = "erp_dataprotect_docs"

# Modèle d'embedding
EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"  # Léger et rapide

# Fichier de documentation
DOC_FILE = "erp_documentation.json"

print(f"📊 Configuration:")
print(f"  - ChromaDB: {CHROMADB_HOST}:{CHROMADB_PORT}")
print(f"  - Collection: {COLLECTION_NAME}")
print(f"  - Modèle embedding: {EMBEDDING_MODEL}")
print(f"  - Documentation: {DOC_FILE}\n")

# ============================================================================
# CONNEXION À CHROMADB
# ============================================================================

print("🔄 Connexion à ChromaDB...")

try:
    # Client ChromaDB
    client = chromadb.HttpClient(
        host=CHROMADB_HOST,
        port=CHROMADB_PORT,
        settings=Settings(allow_reset=True)
    )
    
    # Tester la connexion
    client.heartbeat()
    print("✅ Connexion ChromaDB réussie!\n")
    
except Exception as e:
    print(f"❌ ERREUR: Impossible de se connecter à ChromaDB!")
    print(f"   Assurez-vous que le container ChromaDB tourne sur le port {CHROMADB_PORT}")
    print(f"   Commande: docker-compose up chromadb")
    print(f"\n   Erreur: {str(e)}")
    exit(1)

# ============================================================================
# CRÉATION/RESET DE LA COLLECTION
# ============================================================================

print("🔄 Préparation de la collection...")

try:
    # Supprimer l'ancienne collection si existe
    try:
        client.delete_collection(name=COLLECTION_NAME)
        print(f"  ⚠️  Ancienne collection '{COLLECTION_NAME}' supprimée")
    except:
        pass
    
    # Créer nouvelle collection
    collection = client.create_collection(
        name=COLLECTION_NAME,
        metadata={"description": "Documentation ERP DATAPROTECT pour RAG"}
    )
    
    print(f"✅ Collection '{COLLECTION_NAME}' créée!\n")
    
except Exception as e:
    print(f"❌ ERREUR lors de la création de la collection: {str(e)}")
    exit(1)

# ============================================================================
# CHARGEMENT DE LA DOCUMENTATION
# ============================================================================

print(f"🔄 Chargement de la documentation depuis {DOC_FILE}...")

try:
    with open(DOC_FILE, 'r', encoding='utf-8') as f:
        docs = json.load(f)
    
    print(f"✅ {len(docs)} documents chargés!\n")
    
except FileNotFoundError:
    print(f"❌ ERREUR: Fichier {DOC_FILE} introuvable!")
    print(f"   Assurez-vous que le fichier est dans le même dossier que ce script.")
    exit(1)
except Exception as e:
    print(f"❌ ERREUR lors du chargement: {str(e)}")
    exit(1)

# ============================================================================
# VECTORISATION ET INDEXATION
# ============================================================================

print("🔄 Vectorisation et indexation des documents...")
print(f"   (Cela peut prendre 1-2 minutes pour {len(docs)} documents)\n")

start_time = time.time()

try:
    # Préparer les données pour ChromaDB
    ids = []
    documents = []
    metadatas = []
    
    for doc in docs:
        # ID unique
        ids.append(doc["id"])
        
        # Texte à vectoriser (titre + contenu pour meilleure recherche)
        text = f"{doc['title']}\n\n{doc['content']}"
        documents.append(text)
        
        # Métadonnées
        metadatas.append({
            "category": doc["category"],
            "title": doc["title"]
        })
    
    # Ajouter à la collection (ChromaDB calcule les embeddings automatiquement)
    collection.add(
        ids=ids,
        documents=documents,
        metadatas=metadatas
    )
    
    elapsed_time = time.time() - start_time
    
    print(f"✅ Vectorisation terminée en {elapsed_time:.2f} secondes!")
    print(f"📊 {len(docs)} documents indexés dans ChromaDB\n")
    
except Exception as e:
    print(f"❌ ERREUR lors de la vectorisation: {str(e)}")
    exit(1)

# ============================================================================
# TEST DE RECHERCHE
# ============================================================================

print("🧪 Test de la recherche sémantique...\n")

test_queries = [
    "Comment créer un ticket helpdesk?",
    "Consulter mon solde de congés",
    "Créer une facture client",
    "Qu'est-ce que le service Tasks?"
]

for query in test_queries:
    print(f"🔍 Query: '{query}'")
    
    try:
        # Recherche les 3 documents les plus similaires
        results = collection.query(
            query_texts=[query],
            n_results=3
        )
        
        print(f"   📄 Top 3 résultats:")
        for i, (doc_id, doc, metadata, distance) in enumerate(zip(
            results['ids'][0],
            results['documents'][0],
            results['metadatas'][0],
            results['distances'][0]
        ), 1):
            print(f"      {i}. [{metadata['category']}] {metadata['title']}")
            print(f"         Distance: {distance:.4f}")
            print(f"         Preview: {doc[:100]}...")
        print()
        
    except Exception as e:
        print(f"   ❌ Erreur recherche: {str(e)}\n")

# ============================================================================
# STATISTIQUES FINALES
# ============================================================================

print("=" * 80)
print("✅ VECTORISATION TERMINÉE AVEC SUCCÈS!")
print("=" * 80)
print(f"\n📊 Statistiques:")
print(f"  - Documents indexés: {len(docs)}")
print(f"  - Collection: {COLLECTION_NAME}")
print(f"  - ChromaDB: {CHROMADB_HOST}:{CHROMADB_PORT}")
print(f"  - Temps total: {elapsed_time:.2f} secondes")
print(f"\n✅ Le système RAG est prêt à être utilisé par le Service Chatbot!")
print(f"\n📝 Prochaine étape:")
print(f"  → Lancer le Service Chatbot: cd chatbot-service && npm start")
print(f"  → Le chatbot utilisera automatiquement cette base vectorielle\n")
