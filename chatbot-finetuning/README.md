# CHATBOT FINE-TUNING - ERP DATAPROTECT

## 📦 Contenu

Ce dossier contient tout le nécessaire pour reproduire le fine-tuning du modèle Mistral 7B sur le dataset ERP DATAPROTECT.

### Fichiers:

1. **`notebook_unsloth_simple.py`** (10 cellules)
   - Code complet pour fine-tuning avec Unsloth
   - Durée: ~1h30 sur GPU T4 (Google Colab gratuit)
   - Dataset: 100 paires Q/R ERP DATAPROTECT

2. **`INSTRUCTIONS_COLAB.md`**
   - Guide étape par étape pour utiliser le notebook
   - Configuration GPU, installation Unsloth, etc.

3. **`mistral-7b-instruct-v0.3.Q4_K_M.gguf`** (4.37 GB)
   - Modèle fine-tuné final
   - Format GGUF Q4_K_M optimisé
   - Compatible Ollama

---

## 🚀 Utilisation

### Pour refaire le fine-tuning:

1. Ouvrir Google Colab
2. Créer nouveau notebook
3. Copier le code de `notebook_unsloth_simple.py` cellule par cellule
4. Activer GPU T4
5. Exécuter les 10 cellules dans l'ordre
6. Durée totale: ~1h30

### Pour utiliser le modèle fine-tuné:

```bash
# Charger dans Ollama
ollama create erp-dataprotect -f Modelfile

# Tester
ollama run erp-dataprotect "Comment créer un ticket?"
```

---

## 📊 Spécifications du fine-tuning

- **Modèle base:** Mistral 7B Instruct v0.3
- **Méthode:** LoRA (Low-Rank Adaptation) avec Unsloth
- **Quantization:** 4-bit (QLoRA)
- **Dataset:** 100 exemples (IT, HR, Finance, Operations)
- **Epochs:** 2
- **LoRA rank:** 32
- **LoRA alpha:** 16
- **Batch size:** 2
- **Gradient accumulation:** 4
- **Format final:** GGUF Q4_K_M (~4.37 GB)

---

## 📝 Notes

- Le fine-tuning a été réalisé le 2024-05-21
- Environnement: Google Colab (GPU T4)
- Outil: Unsloth (2x plus rapide que HuggingFace standard)
- Export GGUF direct (pas de conversion manuelle)
