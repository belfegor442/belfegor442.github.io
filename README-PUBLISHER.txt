NORTH ASSEMBLY PUBLISHER
========================

REQUISITOS
- Windows 10/11
- Python 3.10 o superior
- Git instalado
- Una copia CLONADA del repositorio belfegor442/belfegor442.github.io
- Git autenticado para poder hacer push a origin/main

INICIO
1. Actualiza tu copia local de GitHub (git pull).
2. Ejecuta Start-North-Assembly-Publisher.bat desde la carpeta raiz del repositorio.
3. Deja abierta la ventana del Publisher.
4. Copia el codigo temporal que aparece en esa ventana.
5. En la web, ejecuta NorthAssembly.updateNews("Tu noticia") en la consola.
6. Cuando la web pida el codigo, pega el codigo temporal.

El Publisher solo acepta solicitudes procedentes de https://northassembly.work.gd,
solo escucha en 127.0.0.1 y solo modifica docs/news.json. Cada inicio genera
un codigo temporal nuevo. El Publisher crea un commit y lo envia a origin/main.

DETENER
Pulsa Ctrl+C en la ventana del Publisher.

IMPORTANTE
No uses una carpeta descargada como ZIP: debe ser un clon Git con el remoto
origin apuntando a belfegor442/belfegor442.github.io y la rama main sincronizada.
