# North Assembly — Database

Fuente de verdad de la organización. Última actualización: 2026-10-06.

> Este archivo vive en la raíz del repo, fuera de `docs/`, por lo que **no se publica** en GitHub Pages. Contiene datos internos (servidor, economía, herramientas).

| Área | Elemento | Tipo | Estado | Responsable | Descripción / función |
| --- | --- | --- | --- | --- | --- |
| **Organización** | North Assembly | Organización | Activa | Usuario + Anti | Organización principal |
| Organización | Dirección | Dirección | Activa | Usuario + Anti | Ambos tienen autoridad equivalente |
| Organización | Management | Gestión | Activa | Doughtking12 | Manager actual |
| Organización | Developer | Equipo | Vacante | — | Actualmente 0 asignados |
| Organización | Designer | Equipo | Vacante | — | Actualmente 0 asignados |
| Organización | Proyectos | Portfolio | Activo | Varios | Conjunto de proyectos internos |
| **Identidad** | northassembly.work.gd | Dominio | Activo/en configuración | — | Dominio principal |
| Identidad | North Assembly branding | Branding | En limpieza | — | Sustitución completa del antiguo WS |
| Identidad | NA website | Web | En desarrollo | — | Sitio principal de North Assembly |
| **Web** | Página principal | Web | Activa/en desarrollo | — | Presentación de NA |
| Web | `/apps/` | Web | Activa | — | Aplicaciones de North Assembly |
| Web | `/apps/brew` | App page | Activa/en desarrollo | — | Página de Brew |
| Web | Subpáginas | Web | En limpieza | — | Deben utilizar identidad NA |
| **Infraestructura** | GitHub | Plataforma | Activa | — | Repositorios y desarrollo |
| Infraestructura | GitHub Pages | Hosting | Activo | — | Hosting de la web |
| Infraestructura | DNSExit | DNS | Activo/en configuración | — | Gestión DNS del dominio |
| Infraestructura | Servidor local | Servidor | Funcional | — | Backend de servicios NA |
| **Servidor** | Weird-Stuff-Server | Backend | Activo | — | Nombre técnico/repositorio heredado |
| Servidor | `127.0.0.1:8080` | Endpoint | Funcional | — | Servidor local |
| Servidor | SQLite | Base de datos | Funcional | — | Persistencia local |
| Servidor | `msg.term` | Servicio | En desarrollo | — | Comunicación/mensajería |
| Servidor | Registro de usuarios | Servicio | Implementado | — | Sistema de cuentas |
| Servidor | Mensajes | Servicio | Implementado/en desarrollo | — | Comunicación usuario ↔ usuario |
| Servidor | Friends | Servicio | En desarrollo | — | Relaciones entre usuarios |
| Servidor | WS/NA Command | Integración | En desarrollo | — | Control/gestión de proyectos |
| **Software** | Monix | Aplicación | En desarrollo | — | Observabilidad Win32/C++ |
| Software | Datalog | Aplicación | En desarrollo | — | Logs/datos |
| Software | CryptCast | Aplicación | En desarrollo | — | Proyecto de NA |
| Software | DraftPad | Aplicación | En desarrollo | — | Aplicación de edición/notas |
| Software | TeleNet | Aplicación | En desarrollo | — | Proyecto de red/comunicación |
| Software | Meat | Aplicación | En desarrollo | — | Proyecto de NA |
| Software | Brew | Aplicación | En desarrollo | — | Proyecto de NA |
| **Herramientas internas** | NA Command | Sistema interno | En desarrollo | — | Gestión de proyectos/organización |
| Herramientas internas | Commit-like records | Sistema | Implementado | — | Registros tipo `Added x in main.cpp` |
| Herramientas internas | JSON reports | Sistema | Implementado | — | Informes estructurados |
| Herramientas internas | Datalog integration | Integración | En desarrollo | — | Registro de actividad |
| **Economía** | Gambling Bot | Bot | En desarrollo | — | Sistema de casino/economía |
| Economía | Chips | Moneda | Activa | — | Moneda interna del casino |
| Economía | VIP | Sistema | En desarrollo | — | Suscripción mediante chips |
| Economía | VIP Tier 1 | Nivel | Pendiente | — | Primer nivel VIP |
| Economía | VIP Tier 2 | Nivel | Pendiente | — | Segundo nivel VIP |
| Economía | VIP Tier 3 | Nivel | Pendiente | — | Tercer nivel VIP |
| Economía | Casino roles | Roles | En desarrollo | — | Roles exclusivos |
| Economía | Casino channels | Canales | En desarrollo | — | Canales administrados por el bot |
| Economía | Casino permissions | Seguridad | En desarrollo | — | Solo admins pueden controlar el casino |
| **Documentación** | NA Documents | Documentación | En reestructuración | — | Documentación oficial |
| Documentación | Organización | Documento | En reescritura | — | Estructura de North Assembly |
| Documentación | Proyectos | Documento | En desarrollo | — | Registro de proyectos |
| Documentación | Personal | Documento | En desarrollo | — | Organización del equipo |
| Documentación | Sistemas | Documento | En desarrollo | — | Infraestructura y servicios |
| **Desarrollo** | C++ | Tecnología | Activa | — | Principalmente aplicaciones Windows |
| Desarrollo | C++20 | Estándar | Activo | — | Estándar de desarrollo de Monix |
| Desarrollo | Win32 | Tecnología | Activa | — | Aplicaciones Windows |
| Desarrollo | JSON | Formato | Activo | — | Configuración/reportes |
| Desarrollo | SQLite | Base de datos | Activa | — | Backend local |
| **Monix** | HAL | Arquitectura | Definida | — | Capa inferior |
| Monix | Interface | Arquitectura | Definida | — | Interfaz superior |
| Monix | 7 capas | Arquitectura | Congelada | — | Arquitectura oficial |
| Monix | LOG | UI | Definida | — | Registro |
| Monix | TASKS | UI | Definida | — | Tareas |
| Monix | USAGE | UI | Definida | — | Uso de recursos |
| Monix | AI | UI | Definida | — | Funciones AI |
| Monix | SETTINGS | UI | Definida | — | Configuración |
| Monix | RAM/DISC/NETWORK | Monitorización | Definida | — | Métricas principales |
| Monix | `universal.cpp` | Sistema | En desarrollo | — | Filtrado/reducción de logs |
| Monix | 100k → 20k logs/s | Objetivo | Definido | — | Eliminar repetición/noise |
| **Branding** | Laboratory BBS | Tema | Definido | — | Tema visual |
| Branding | Minimal | Tema | Definido | — | Tema visual |
| Branding | VHS Gothic | Tipografía | Definida | — | Fuente |
| Branding | Adore64 | Tipografía | Definida | — | Fuente |
| Branding | Perfect DOS VGA 437 | Tipografía | Definida | — | Fuente |
| Branding | Windows Command Prompt | Referencia | Definida | — | Estética |
| Branding | CRT / scanlines | Estética | Definida | — | Estilo visual |
| **Histórico** | Weird Stuff | Identidad anterior | Reemplazada | — | Antiguo nombre de NA |
| Histórico | WS branding | Branding anterior | En eliminación | — | No debe permanecer en NA |
| Histórico | WS apps | Aplicaciones anteriores | Parcialmente heredadas | — | Algunas mantienen código/repositorios históricos |
| **Gobernanza** | Usuario | Director | Activo | — | Dirección |
| Gobernanza | Anti | Director | Activo | — | Dirección |
| Gobernanza | Doughtking12 | Manager | Activo | — | Manager actual |
| Gobernanza | Acrid | Manager | Despedido | — | Antiguo manager |
| **Objetivo** | Rebirth | Estrategia | En marcha | Dirección | Reorganizar NA |
| Objetivo | Limpieza | Operación | En marcha | Dirección | Eliminar restos de WS |
| Objetivo | Organización | Operación | En marcha | Dirección | Estructurar proyectos/equipo |
| Objetivo | Más trabajo | Estrategia | Pendiente | Dirección | Reactivar/desarrollar proyectos |
| Objetivo | Profesionalización | Estrategia | En marcha | Dirección | Hacer NA más coherente como organización |
