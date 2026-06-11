"""
Script de vectorisation de la documentation ERP pour RAG
========================================================

Ce script charge la documentation ERP depuis erp_documentation.json
et la vectorise dans ChromaDB pour la recherche sÃ©mantique.

PrÃ©requis:
- ChromaDB installÃ©: pip install chromadb
- sentence-transformers installÃ©: pip install sentence-transformers
- ChromaDB container qui tourne (port 8000)
"""

import json
import chromadb
from chromadb.config import Settings

import time

print("ðŸ”„ Initialisation du script de vectorisation RAG...\n")

# ============================================================================
# CONFIGURATION
# ============================================================================

# ChromaDB connection
CHROMADB_HOST = "erp-chromadb"
CHROMADB_PORT = 8000
COLLECTION_NAME = "erp_dataprotect_docs"

# ModÃ¨le d'embedding
EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"  # LÃ©ger et rapide

# Fichier de documentation
DOC_FILE = "erp_documentation.json"

print(f"ðŸ“Š Configuration:")
print(f"  - ChromaDB: {CHROMADB_HOST}:{CHROMADB_PORT}")
print(f"  - Collection: {COLLECTION_NAME}")
print(f"  - ModÃ¨le embedding: {EMBEDDING_MODEL}")
print(f"  - Documentation: {DOC_FILE}\n")

# ============================================================================
# CONNEXION Ã€ CHROMADB
# ============================================================================

print("ðŸ”„ Connexion Ã  ChromaDB...")

try:
    # Client ChromaDB
    client = chromadb.HttpClient(
        host=CHROMADB_HOST,
        port=CHROMADB_PORT,
        settings=Settings(allow_reset=True)
    )
    
    # Tester la connexion
    client.heartbeat()
    print("âœ… Connexion ChromaDB rÃ©ussie!\n")
    
except Exception as e:
    print(f"âŒ ERREUR: Impossible de se connecter Ã  ChromaDB!")
    print(f"   Assurez-vous que le container ChromaDB tourne sur le port {CHROMADB_PORT}")
    print(f"   Commande: docker-compose up chromadb")
    print(f"\n   Erreur: {str(e)}")
    exit(1)

# ============================================================================
# CRÃ‰ATION/RESET DE LA COLLECTION
# ============================================================================

print("ðŸ”„ PrÃ©paration de la collection...")

try:
    # Supprimer l'ancienne collection si existe
    try:
        client.delete_collection(name=COLLECTION_NAME)
        print(f"  âš ï¸  Ancienne collection '{COLLECTION_NAME}' supprimÃ©e")
    except:
        pass
    
    # CrÃ©er nouvelle collection
    collection = client.create_collection(
        name=COLLECTION_NAME,
        metadata={"description": "Documentation ERP DATAPROTECT pour RAG"}
    )
    
    print(f"âœ… Collection '{COLLECTION_NAME}' crÃ©Ã©e!\n")
    
except Exception as e:
    print(f"âŒ ERREUR lors de la crÃ©ation de la collection: {str(e)}")
    exit(1)

# ============================================================================
# CHARGEMENT DE LA DOCUMENTATION
# ============================================================================

print(f"ðŸ”„ Chargement de la documentation depuis {DOC_FILE}...")

try:
    with open(DOC_FILE, 'r', encoding='utf-8') as f:
        docs = json.load(f)
    
    print(f"âœ… {len(docs)} documents chargÃ©s!\n")
    
except FileNotFoundError:
    print(f"âŒ ERREUR: Fichier {DOC_FILE} introuvable!")
    print(f"   Assurez-vous que le fichier est dans le mÃªme dossier que ce script.")
    exit(1)
except Exception as e:
    print(f"âŒ ERREUR lors du chargement: {str(e)}")
    exit(1)

# ============================================================================
# VECTORISATION ET INDEXATION
# ============================================================================

print("ðŸ”„ Vectorisation et indexation des documents...")
print(f"   (Cela peut prendre 1-2 minutes pour {len(docs)} documents)\n")

start_time = time.time()

try:
    # PrÃ©parer les donnÃ©es pour ChromaDB
    ids = []
    documents = []
    metadatas = []
    
    for doc in docs:
        # ID unique
        ids.append(doc["id"])
        
        # Texte Ã  vectoriser (titre + contenu pour meilleure recherche)
        text = f"{doc['title']}\n\n{doc['content']}"
        documents.append(text)
        
        # MÃ©tadonnÃ©es
        metadatas.append({
            "category": doc["category"],
            "title": doc["title"]
        })
    
    # Ajouter Ã  la collection (ChromaDB calcule les embeddings automatiquement)
    collection.add(
        ids=ids,
        documents=documents,
        metadatas=metadatas
    )
    
    elapsed_time = time.time() - start_time
    
    print(f"âœ… Vectorisation terminÃ©e en {elapsed_time:.2f} secondes!")
    print(f"ðŸ“Š {len(docs)} documents indexÃ©s dans ChromaDB\n")
    
except Exception as e:
    print(f"âŒ ERREUR lors de la vectorisation: {str(e)}")
    exit(1)

# ============================================================================
# TEST DE RECHERCHE
# ============================================================================

print("ðŸ§ª Test de la recherche sÃ©mantique...\n")

test_queries = [
    "Comment crÃ©er un ticket helpdesk?",
    "Consulter mon solde de congÃ©s",
    "CrÃ©er une facture client",
    "Qu'est-ce que le service Tasks?"
]

for query in test_queries:
    print(f"ðŸ” Query: '{query}'")
    
    try:
        # Recherche les 3 documents les plus similaires
        results = collection.query(
            query_texts=[query],
            n_results=3
        )
        
        print(f"   ðŸ“„ Top 3 rÃ©sultats:")
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
        print(f"   âŒ Erreur recherche: {str(e)}\n")

# ============================================================================
# STATISTIQUES FINALES
# ============================================================================

print("=" * 80)
print("âœ… VECTORISATION TERMINÃ‰E AVEC SUCCÃˆS!")
print("=" * 80)
print(f"\nðŸ“Š Statistiques:")
print(f"  - Documents indexÃ©s: {len(docs)}")
print(f"  - Collection: {COLLECTION_NAME}")
print(f"  - ChromaDB: {CHROMADB_HOST}:{CHROMADB_PORT}")
print(f"  - Temps total: {elapsed_time:.2f} secondes")
print(f"\nâœ… Le systÃ¨me RAG est prÃªt Ã  Ãªtre utilisÃ© par le Service Chatbot!")
print(f"\nðŸ“ Prochaine Ã©tape:")
print(f"  â†’ Lancer le Service Chatbot: cd chatbot-service && npm start")
print(f"  â†’ Le chatbot utilisera automatiquement cette base vectorielle\n")
