/**
 * CLIENT RAG - ChromaDB
 * =====================
 * 
 * Module de recherche sémantique dans la documentation ERP
 * via ChromaDB (base vectorielle)
 */

const { ChromaClient } = require('chromadb');

// Configuration
const CHROMADB_URL = process.env.CHROMADB_URL || 'http://chromadb:8000';
const COLLECTION_NAME = process.env.CHROMADB_COLLECTION || 'erp_dataprotect_docs';

// Client ChromaDB
let client = null;
let collection = null;

/**
 * Initialise la connexion à ChromaDB
 */
async function initialize() {
  try {
    client = new ChromaClient({ path: CHROMADB_URL });
    
    // Récupérer la collection (doit exister - créée par vectorize_docs.py)
    collection = await client.getCollection({
      name: COLLECTION_NAME
    });
    
    console.log(`✅ RAG Client connected to ChromaDB: ${CHROMADB_URL}`);
    console.log(`✅ Collection loaded: ${COLLECTION_NAME}`);
    
    return true;
  } catch (error) {
    console.error(`❌ Failed to connect to ChromaDB: ${error.message}`);
    console.error(`   Make sure ChromaDB is running and collection '${COLLECTION_NAME}' exists`);
    throw error;
  }
}

/**
 * Recherche les documents les plus pertinents pour une query
 * 
 * @param {string} query - Question de l'utilisateur
 * @param {number} nResults - Nombre de documents à retourner (défaut: 3)
 * @returns {Promise<Array>} - Liste de documents pertinents
 */
async function searchRelevantDocs(query, nResults = 3) {
  try {
    // S'assurer que la collection est chargée
    if (!collection) {
      await initialize();
    }

    // Recherche sémantique
    const results = await collection.query({
      queryTexts: [query],
      nResults: nResults
    });

    // Formater les résultats
    const docs = [];
    
    if (results.ids && results.ids[0]) {
      for (let i = 0; i < results.ids[0].length; i++) {
        docs.push({
          id: results.ids[0][i],
          content: results.documents[0][i],
          category: results.metadatas[0][i].category,
          title: results.metadatas[0][i].title,
          distance: results.distances ? results.distances[0][i] : null
        });
      }
    }

    console.log(`RAG Search: "${query}" → ${docs.length} results`);
    
    return docs;

  } catch (error) {
    console.error(`RAG search error: ${error.message}`);
    // Retourner array vide plutôt que crasher
    return [];
  }
}

/**
 * Recherche des documents par catégorie
 * 
 * @param {string} category - Catégorie (it, hr, finance, operations, etc.)
 * @param {number} nResults - Nombre de documents
 * @returns {Promise<Array>} - Documents de la catégorie
 */
async function searchByCategory(category, nResults = 10) {
  try {
    if (!collection) {
      await initialize();
    }

    const results = await collection.get({
      where: { category: category },
      limit: nResults
    });

    const docs = [];
    
    if (results.ids) {
      for (let i = 0; i < results.ids.length; i++) {
        docs.push({
          id: results.ids[i],
          content: results.documents[i],
          category: results.metadatas[i].category,
          title: results.metadatas[i].title
        });
      }
    }

    return docs;

  } catch (error) {
    console.error(`Category search error: ${error.message}`);
    return [];
  }
}

/**
 * Test de connexion à ChromaDB
 * 
 * @returns {Promise<boolean>} - True si connexion OK
 */
async function testConnection() {
  try {
    await initialize();
    
    // Test avec une query simple
    const results = await searchRelevantDocs("test", 1);
    
    console.log('✅ RAG test successful');
    return true;
    
  } catch (error) {
    console.error(`❌ RAG test failed: ${error.message}`);
    return false;
  }
}

// Initialiser au chargement du module
initialize().catch(err => {
  console.error('Failed to initialize RAG client:', err.message);
});

module.exports = {
  searchRelevantDocs,
  searchByCategory,
  testConnection,
  initialize
};
