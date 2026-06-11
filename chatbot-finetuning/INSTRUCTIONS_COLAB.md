# INSTRUCTIONS GOOGLE COLAB - FINE-TUNING MISTRAL 7B

## 📋 Prérequis

- Compte Google
- Accès à Google Colab: https://colab.research.google.com/
- Google Drive avec ~10 GB d'espace libre
- 4-5 heures de disponibilité

---

## 🚀 ÉTAPE PAR ÉTAPE

### **Étape 1: Ouvrir Google Colab (2 min)**

1. Aller sur https://colab.research.google.com/
2. Cliquer sur **"Fichier" > "Nouveau notebook"**
3. Renommer le notebook: **"DATAPROTECT_Fine-tuning"**

---

### **Étape 2: Activer le GPU (1 min)**

⚠️ **CRITIQUE:** Sans GPU, le fine-tuning prendrait 30-40h!

1. Cliquer sur **"Runtime"** (ou "Exécution")
2. **"Change runtime type"** (ou "Modifier le type d'exécution")
3. **Hardware accelerator** → Sélectionner **"GPU"**
4. **GPU type** → Sélectionner **"T4"** (gratuit)
5. Cliquer sur **"Save"**

✅ Vérifier: Une icône GPU devrait apparaître en haut à droite

---

### **Étape 3: Copier le code (5 min)**

1. Ouvrir le fichier `notebook_finetuning.py`
2. Le code est divisé en **13 CELLULES** (marquées par des commentaires)
3. Pour chaque cellule:
   - Créer une nouvelle cellule dans Colab (bouton **"+ Code"**)
   - Copier le code de la cellule
   - Coller dans Colab

**Structure des cellules:**
```
CELLULE 1: Installation packages (5 min)
CELLULE 2: Imports (30 sec)
CELLULE 3: Génération données (2 min)
CELLULE 4: Configuration modèle (10 sec)
CELLULE 5: Chargement Mistral 7B (3-5 min)
CELLULE 6: Préparation dataset (30 sec)
CELLULE 7: Config training (10 sec)
CELLULE 8: Entraînement (3-4 HEURES) ⏱️
CELLULE 9: Sauvegarde modèle (1 min)
CELLULE 10: Tests (2 min)
CELLULE 11: Export GGUF (10-15 min)
CELLULE 12: Upload Google Drive (5 min)
CELLULE 13: Nettoyage (30 sec)
```

---

### **Étape 4: Exécuter les cellules (3-4h total)**

#### **Cellules 1-7 (rapides - 15 min):**
- Exécuter les cellules **1 à 7** une par une
- Attendre que chaque cellule termine avant la suivante
- ✅ Vérifier qu'il n'y a pas d'erreur

#### **Cellule 8 (LONGUE - 3-4h):** ⏱️
- Lancer la cellule 8
- **⚠️ NE PAS FERMER L'ONGLET COLAB!**
- Le notebook doit rester ouvert pendant tout le training

**Pendant le training:**
- ☕ Tu peux faire autre chose (laisser l'onglet ouvert)
- 📊 Progress bar montre l'avancement
- 📉 Courbes de loss et perplexity descendent
- ⏰ Durée: 3-4 heures sur GPU T4

**Ce qui se passe:**
```
Epoch 1/3: ~1h15min
├─ Step 10/450: loss=2.45
├─ Step 100/450: loss=1.89
├─ Step 150/450: loss=1.56
└─ Epoch 1 complete!

Epoch 2/3: ~1h15min
├─ Step 10/450: loss=1.42
├─ Step 100/450: loss=1.18
└─ Epoch 2 complete!

Epoch 3/3: ~1h15min
├─ Step 10/450: loss=1.05
├─ Step 150/450: loss=0.89
└─ Training complete! ✅
```

#### **Cellules 9-13 (finales - 20 min):**
- Exécuter après le training
- Sauvegarde, tests, export GGUF
- Upload sur Google Drive

---

### **Étape 5: Télécharger le modèle (10 min)**

1. Aller sur https://drive.google.com
2. Ouvrir le dossier **"ERP_DATAPROTECT"**
3. Fichier: **"mistral-erp-dataprotect-q4.gguf"** (~4.3 GB)
4. Clic droit → **"Télécharger"**
5. Sauvegarder dans ton projet local: `./models/`

---

## ⚠️ PROBLÈMES COURANTS

### **Erreur: "GPU not available"**
**Solution:** 
- Vérifier Runtime > Change runtime type > GPU = T4
- Redémarrer le runtime: Runtime > Restart runtime

### **Erreur: "Out of memory"**
**Solution:**
- Réduire `per_device_train_batch_size` de 4 à 2 dans CELLULE 7
- Runtime > Restart runtime et relancer

### **Erreur: "Colab disconnected"**
**Solution:**
- Colab se déconnecte après 90 min d'inactivité
- Garde l'onglet ouvert et bouge la souris de temps en temps
- Ou installe l'extension Chrome "Colab Auto-Clicker"

### **Training trop lent**
**Vérifier:**
- GPU bien activé? (icône GPU en haut à droite)
- GPU type = T4? (pas CPU)
- Si problème persiste: Runtime > Restart runtime

---

## 📊 MÉTRIQUES À SURVEILLER

**Pendant le training (Cellule 8):**

✅ **Bon signe:**
- Loss qui descend: 2.5 → 1.5 → 0.9
- Eval loss qui descend
- Perplexity qui baisse

❌ **Mauvais signe:**
- Loss qui augmente
- Loss qui stagne à 3.0+
- Erreurs "NaN" dans les logs

---

## 🎯 CHECKLIST FINALE

Avant de fermer Colab, vérifie:

- [ ] Training terminé (3 epochs complets)
- [ ] Modèle sauvegardé dans `/content/mistral-erp-finetuned`
- [ ] Tests passés (Cellule 10)
- [ ] Export GGUF réussi
- [ ] Fichier copié sur Google Drive
- [ ] Fichier téléchargé localement (~4.3 GB)
- [ ] Fichier dans `./models/mistral-erp-dataprotect-q4.gguf`

---

## 📞 AIDE RAPIDE

**Si bloqué:**
1. Lire le message d'erreur complet
2. Chercher l'erreur dans les solutions ci-dessus
3. Restart runtime et réessayer
4. Vérifier que GPU T4 est bien activé

**Temps total estimé:** 4-5 heures
- Setup: 20 min
- Training: 3-4h
- Export: 20 min
- Download: 10 min

---

## ✅ PROCHAINE ÉTAPE

Une fois le modèle téléchargé:
→ Passer à l'intégration dans la plateforme (voir `INSTRUCTIONS_COMPLETE.md`)
