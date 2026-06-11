# CHATBOT RAG - ERP DATAPROTECT

## 📦 Contenu

Ce dossier contient la documentation ERP vectorisée pour le système RAG (Retrieval-Augmented Generation) du chatbot.

### Fichiers:

1. **`erp_documentation.json`** (50+ documents)
   - Documentation complète des 4 domaines ERP
   - IT Domain: Helpdesk, Comptes, Équipements, Monitoring, Licences
   - HR Domain: Employés, Congés, Recrutement, Paie, Performance
   - Finance Domain: Budget, Rapports, Paiements, Dépenses, Factures
   - Operations Domain: Tâches, Workflows, Fournisseurs, Projets, Inventaire

2. **`vectorize_docs.py`**
   - Script Python pour vectoriser la documentation
   - Utilise ChromaDB comme base vectorielle
   - Crée des embeddings pour recherche sémantique

---

## 🚀 Utilisation

### Vectoriser la documentation:

```bash
# Installer dépendances
pip install chromadb sentence-transformers

# Lancer vectorisation
cd chatbot-rag/
python vectorize_docs.py

# Résultat: Collection ChromaDB "erp_dataprotect_docs" créée
```

### Tester la recherche:

```python
import chromadb

client = chromadb.PersistentClient(path="./chroma_db")
collection = client.get_collection("erp_dataprotect_docs")

# Recherche sémantique
results = collection.query(
    query_texts=["Comment créer un ticket?"],
    n_results=3
)

print(results['documents'])
```

---

## 📊 Structure de la documentation

```json
{
  "id": "doc_001",
  "domain": "IT",
  "service": "Helpdesk",
  "title": "Créer un ticket helpdesk",
  "content": "Pour créer un ticket...",
  "metadata": {
    "category": "guide",
    "keywords": ["ticket", "helpdesk", "support"]
  }
}
```

### Statistiques:

- **Total documents:** 50+
- **IT Domain:** 12 documents
- **HR Domain:** 14 documents
- **Finance Domain:** 12 documents
- **Operations Domain:** 12 documents

---

## 🔧 Configuration ChromaDB

Le script `vectorize_docs.py` crée:

- **Collection:** `erp_dataprotect_docs`
- **Embedding model:** `sentence-transformers/all-MiniLM-L6-v2`
- **Distance metric:** Cosine similarity
- **Persistence:** `./chroma_db/`

---

## 🔄 Workflow RAG

1. **User query:** "Comment créer un ticket?"
2. **Vectorisation:** Query → embedding vector
3. **Recherche:** ChromaDB trouve top 3 docs similaires
4. **Context:** Docs + query → LLM
5. **Response:** LLM génère réponse contextuelle

---

## 📝 Notes

- La documentation est mise à jour manuellement
- Pour ajouter de nouveaux docs: éditer `erp_documentation.json` puis re-vectoriser
- Les embeddings sont persistés dans `./chroma_db/`
- Le chatbot-service utilise cette base via l'API ChromaDB

