"""Entrena el modelo facial LBPH con los rostros guardados en data/rostros.

Uso:
    py python/entrenar.py                  -> entrena desde data/rostros
    py python/entrenar.py <carpeta>        -> entrena desde una carpeta personalizada
"""

import os
import sys

sys.stdout.reconfigure(encoding='utf-8')

from face_utils import ROSTROS_DIR, entrenar  # noqa: E402


def main():
    carpeta = sys.argv[1] if len(sys.argv) > 1 else ROSTROS_DIR
    print(f'Entrenando modelo LBPH desde: {carpeta}')
    try:
        resultado = entrenar(carpeta)
    except (ValueError, RuntimeError, FileNotFoundError) as e:
        print(f'ERROR: {e}')
        sys.exit(1)
    print('Modelo guardado en python/modelo/')
    print(f"  Imágenes encontradas: {resultado['rostros']}")
    print(f"  Caras entrenadas:     {resultado['entrenados']}")
    print(f"  Personas:             {', '.join(resultado['personas'])}")
    if resultado['omitidos']:
        print(f'  Sin cara detectada:   {", ".join(resultado["omitidos"])}')


if __name__ == '__main__':
    main()
