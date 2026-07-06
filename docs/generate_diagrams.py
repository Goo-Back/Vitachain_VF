"""
Génère automatiquement les PNG de tous les fichiers .puml dans docs/uml/
en utilisant l'API publique PlantUML (aucune installation Java requise).

Usage :
    cd docs
    python generate_diagrams.py

Les PNG sont sauvegardés dans docs/uml/png/
"""

import zlib
import urllib.request
import urllib.error
import os
import sys
import time
from pathlib import Path

PLANTUML_SERVER = "https://www.plantuml.com/plantuml/png"
PUML_DIR  = Path(__file__).parent / "uml"
OUT_DIR   = Path(__file__).parent / "uml" / "png"
DELAY_SEC = 0.8   # délai entre requêtes pour ne pas surcharger le serveur


# ── Encodage PlantUML (deflate + base64 custom) ────────────────────────────
_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_"

def _encode64(data: bytes) -> str:
    result = []
    for i in range(0, len(data), 3):
        b0 = data[i]     if i     < len(data) else 0
        b1 = data[i + 1] if i + 1 < len(data) else 0
        b2 = data[i + 2] if i + 2 < len(data) else 0
        result.append(_ALPHABET[(b0 >> 2) & 0x3F])
        result.append(_ALPHABET[((b0 & 0x3) << 4) | ((b1 >> 4) & 0xF)])
        result.append(_ALPHABET[((b1 & 0xF) << 2) | ((b2 >> 6) & 0x3)])
        result.append(_ALPHABET[b2 & 0x3F])
    return "".join(result)


def encode_plantuml(text: str) -> str:
    """Compresse et encode un source PlantUML pour l'URL de l'API."""
    compressed = zlib.compress(text.encode("utf-8"), 9)[2:-4]  # strip en-tête zlib
    return _encode64(compressed)


# ── Téléchargement ─────────────────────────────────────────────────────────
def download_png(puml_text: str, dest: Path) -> bool:
    encoded = encode_plantuml(puml_text)
    url = f"{PLANTUML_SERVER}/{encoded}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "vitachain-diagram-gen/1.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            if resp.status != 200:
                print(f"    HTTP {resp.status} — ignoré")
                return False
            content = resp.read()
            # PlantUML renvoie une image PNG ou une image d'erreur rouge
            # On vérifie la signature PNG (\x89PNG)
            if content[:4] != b"\x89PNG":
                print("    Réponse non-PNG (probable erreur PlantUML) — ignoré")
                return False
            dest.write_bytes(content)
            return True
    except urllib.error.URLError as e:
        print(f"    Erreur réseau : {e.reason}")
        return False
    except Exception as e:
        print(f"    Erreur inattendue : {e}")
        return False


# ── Main ───────────────────────────────────────────────────────────────────
def main():
    if not PUML_DIR.exists():
        print(f"Dossier introuvable : {PUML_DIR}")
        sys.exit(1)

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    puml_files = sorted(PUML_DIR.glob("*.puml"))
    if not puml_files:
        print("Aucun fichier .puml trouvé.")
        sys.exit(0)

    print("=" * 60)
    print(f"  Generation de {len(puml_files)} diagramme(s)")
    print(f"  Sortie : {OUT_DIR}")
    print("=" * 60)
    print()

    ok = 0
    fail = 0
    for puml_path in puml_files:
        png_name = puml_path.stem + ".png"
        out_path = OUT_DIR / png_name
        print(f"[>] {puml_path.name}")

        text = puml_path.read_text(encoding="utf-8")
        if download_png(text, out_path):
            size_kb = out_path.stat().st_size // 1024
            print(f"    OK  {png_name}  ({size_kb} Ko)")
            ok += 1
        else:
            print(f"    FAIL  {png_name}")
            fail += 1

        time.sleep(DELAY_SEC)

    print()
    print("=" * 60)
    print(f"  Resultat : {ok} succes, {fail} echec(s)")
    print("=" * 60)

    if fail:
        sys.exit(1)


if __name__ == "__main__":
    main()
