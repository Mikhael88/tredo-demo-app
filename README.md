# Babylon HotSwap Studio 🪐
### Blender to GLB Sandbox con Hot-Swap & Persistenza Materiali

Questa applicazione locale è progettata specificamente per risolvere il problema comune nell'iterazione di prodotti tra **Blender** e **Babylon.js**:

> **Il problema tipico**: Esporti da Blender in `.glb`, lo apri nella Sandbox di Babylon, regoli Tone Mapping, esposizione, contrasto, colori PBR e texture. Poi ti accorgi che devi correggere una mesh o una UV su Blender, ri-esporti il GLB con gli stessi nomi... e la Sandbox di Babylon resetta tutto costringendoti a rifare tutto da capo!

### ✨ Cosa fa Babylon HotSwap Studio:
1. **Hot-Swap Intelligente del GLB**:
   - Trascina il nuovo file `.glb` (o `.gltf`) nella finestra.
   - La geometria si aggiorna all'istante.
   - **Tutte le modifiche ai materiali vengono mantenute automaticamente** (associati tramite il nome del materiale impostato su Blender).
   - **Tone Mapping, esposizione, contrasto e illuminazione HDRI rimangono identici**.
   - **L'inquadratura della camera non si resetta**, permettendoti di valutare immediatamente le modifiche al modello dalla stessa angolazione.
2. **Drag & Drop di Texture e Ambienti HDRI**:
   - Trascina un'immagine (`.png`, `.jpg`, `.webp`) direttamente sopra una mesh nel 3D: apparirà un popup immediato per assegnarla come **Albedo**, **Normal/Bump**, **Metallic/Roughness**, **Emissive** o **Ambient Occlusion**.
   - Trascina un file `.hdr` o `.env` per aggiornare istantaneamente l'ambiente di riflessione e luce dello studio.
3. **Ambient Occlusion (SSAO) in Tempo Reale**:
   - Generazione di ombre di contatto e auto-occlusione del modello su se stesso (fessure, fori, pieghe e giunzioni tra componenti).
   - Parametri completamente regolabili in tempo reale: Intensità (Total Strength), Raggio (Radius), Campioni (Samples da 8 a 64), Livello Base, Distanza Massima (Max Depth), Filtro Bilaterale (Denoise) e Risoluzione buffer texture AO.
4. **Inspector Ufficiale di Babylon Sandbox Integrato**:
   - Premi il tasto `I` (o clicca su **🔍 Inspector**) per aprire l'inspector completo ufficiale di Babylon (lo stesso identico della Babylon Sandbox online) con pieno controllo su nodi, animazioni, shader e proprietà avanzate.
5. **Esportazione GLB Finale**:
   - Clicca su **💾 Esporta GLB** per scaricare direttamente un nuovo file `.glb` con tutte le modifiche ai materiali PBR e le texture applicate!
6. **Salvataggio & Caricamento Preset**:
   - Salva e ricarica le tue configurazioni di materiali e scena in formato `.json`.

---

## 🚀 Come avviarlo

### Metodo 1: Doppio click (Windows)
Fai doppio click sul file `start.bat`. Aprirà il browser all'indirizzo `http://localhost:5173` e avvierà il server locale.

### Metodo 2: Da terminale
```bash
npm run dev
```
Apri [http://localhost:5173](http://localhost:5173) nel browser.

---

## 🕹️ Scorciatoie da tastiera
- `I`: Apri / Chiudi il Babylon Sandbox Inspector completo
- `F`: Ricentra la camera sul modello (Frame Model)
- `R`: Attiva / Disattiva rotazione automatica del prodotto
- `Esc`: Chiudi finestre modali
