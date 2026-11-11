# NEW WORLD — Registro de implementación

**Fuente funcional:** especificación maestra NEW WORLD, versión 1.0 (5 de noviembre de 2026).
**Ámbito auditado:** cliente activo en `docs/Apps/NewWorld`.
**Última auditoría:** 11 de noviembre de 2026.
**Estado de publicación:** cambios locales, sin commit ni despliegue.

Este registro distingue el código del cliente publicado, la referencia .NET heredada y las funciones que siguen pendientes. Una interfaz o un modelo de datos aislado no se considera un sistema terminado.

## Arquitectura observada

- El juego web activo utiliza HTML5, CSS y JavaScript. No se ha introducido React.
- El navegador del anfitrión mantiene el estado autoritativo de la partida; MQTT transporta mensajes entre clientes.
- El guardado operativo del anfitrión sigue en el almacenamiento local del perfil del navegador. Ahora puede exportarse e importarse como archivo portátil cifrado con contraseña (AES-256-GCM y PBKDF2-SHA-256); esto permite trasladar la copia, pero no crea nube, autoridad central ni relevo automático del anfitrión.
- `Apps/NewWorld/Server` contiene una referencia heredada .NET 8/PostgreSQL. No es el servidor que ejecuta actualmente la aplicación publicada.
- El SVG original se conserva como recurso inmutable. Las etiquetas originales del mapa no se han reescrito; los nombres oficiales del escenario están en los datos de Estado y en sus claves estables.

## Estado de los bloques

| Bloque | Estado | Implementación observada | Trabajo que falta para cumplir la especificación |
|---|---|---|---|
| 1. Identidad, bucle y órdenes | **PARCIAL** | Partida, jugador y membresías separadas; órdenes de intención validadas por host contra autenticación, mundo, versión, membresía, permiso, recursos y reglas del sistema. Reintentos idempotentes; aceptaciones y rechazos persistidos con actor, Estado, payload, fechas y código. targetWorldDate valida fechas gregorianas: solo se procesa la fecha actual; fechas imposibles/pasadas/futuras no se ejecutan. rejectionReason guarda código, texto y fecha de rechazo estructurados. Snapshot/delta con versión. | Aún no hay agenda para ejecutar órdenes en fechas futuras; se rechazan explícitamente en vez de ejecutarlas antes de tiempo. El historial de eventos del cliente mantiene una ventana acotada y faltan archivo completo consultable/exportable y trazabilidad inmutable de largo plazo en un almacenamiento duradero compartido. Faltan estados completos recovering/closed y flujos de recuperación de sesión más ricos. |
| 2. Gobierno y política inicial | **PARCIAL** | Constitución, instituciones, cargos, partidos, permisos, decisiones y votaciones; editor de políticas mediante tarjetas y deslizadores. | Procedimientos constitucionales completos, composición/selección de instituciones, legitimidad y estabilidad configurables y perfiles oficiales aprobados para cada Estado. |
| 3. Economía, industria y producción | **PARCIAL** | Empresas NPC, instalaciones/recetas, inventarios, mercados, demanda agregada, precios, producción, rutas comerciales y libro de transacciones. | Salarios, empleo completo, propiedad de empresas, quiebras, fiscalidad, crédito, deuda, inflación monetaria, cambio entre monedas y mercado bursátil. |
| 4. Sociedad y NPC | **PARCIAL** | Grupos de población agregados, necesidades y efectos básicos de servicios/escasez. | Cohortes de edad, natalidad, mortalidad, epidemias, movilidad social, migración, familias y NPC relevantes con trazabilidad completa. |
| 5. Diplomacia inicial | **PARCIAL** | Relaciones interestatales, declaración de guerra, paz y propuestas/aceptación de rutas comerciales. | Tratados generales con cláusulas, duración, expiración, contraofertas, incumplimiento, sanciones y representación diplomática completa. |
| 6. Sistema militar | **PARCIAL** | Unidades, reclutamiento, movimiento/ataque por rutas, batallas, bajas y ocupaciones con transferencia territorial posterior. | Logística y suministro, clima/terreno aplicado al combate, fases reproducibles, fortificaciones/asedios, prisioneros, deserción y retirada detallada. |
| 7. Territorio, provincias y ciudades | **PARCIAL** | SVG interactivo; registro externo v1 de las 16 geometrías estatales con claves estables y hash verificado; capas de administración, soberanía y control efectivo; selección por ID de geometría. | Las geometrías del SVG son estatales, no límites provinciales. Faltan límites provinciales reales, catálogo operativo de ciudades/capitales, fronteras derivadas y órdenes completas de traslado de capital/transferencia legal. No se infieren provincias desde paths estatales. |
| 8. Tecnología e investigación | **PARCIAL** | Cuatro tecnologías de escenario, doce filtros de dominio, árbol en tarjetas con estado derivado de datos del servidor, prerrequisitos, materiales, personal, financiación, instituciones públicas/privadas, progreso, descubrimiento separado de adopción y efecto aplicado una sola vez. | Ampliar el catálogo solo con tecnologías aprobadas; difusión por comercio/diplomacia/migración/espionaje/publicaciones/imitación/transferencia; inventores y equipos NPC, propiedad intelectual, especialización, prioridades públicas e incentivos privados y adopción por sector/provincia. |
| 9. Gobierno avanzado | **PARCIAL** | Cargos y nombramientos con permisos, competencias constitucionales, instituciones asignadas, umbrales de aprobación configurados, decisiones y votaciones; el panel ahora expone esos límites y distingue explícitamente lo que no está configurado. | Modelo operativo de cámaras/escaños, elecciones y escrutinio, derechos de oposición, moción de censura/confianza, comisiones, investigaciones, vacancia e inactividad y transición de poder. Las reglas electorales y plazos no están definidos y no se inventan. |
| 10. Interfaz principal | **PARCIAL** | Mapa dominante, barra superior, navegación contextual de 19 vistas con correspondencia 19/19 y aria-controls, paneles con estados loading/empty/ready/stale/error/no-permission, catálogo TheoTown de 145 opciones, HUD BUILD/CITY/ECONOMY/GOV/PAUSE y editor de leyes visual. `command-inbox.js` agrupa alertas repetidas por tipo/Estado/fecha, asigna categoría, prioridad, origen, ID, fecha, texto, lectura y ruta de navegación; incluye órdenes locales/enviadas, lectura persistida por jugador/partida, rutas a los 19 sistemas, Escape, foco, live regions, responsive y reduced-motion. | Falta el deep-link que abra el registro concreto dentro de cada vista (ahora selecciona Estado y abre el sistema relacionado); estado no-permission disponible como contrato común pero todavía no se aplica de forma uniforme a cada acción/registro; validación visual real con navegador en resoluciones, zoom y tecnologías de asistencia, además de pruebas manuales completas por rol. |
| 11. Reloj y simulación | **COMPLETADO** | WorldClock autoritativo en el host: fecha gregoriana desde 1500, estado running/paused, versión, referencia real y acumulador persistido. Exactamente 300 segundos por día a 1x; no hay velocidades extra. El host procesa lotes retrasados sin saltos ni duplicados. PauseVote es por jugador conectado y partida; pasa con mayoría estricta (>50%), empate no pasa, abstención no suma y cambio de roster reinicia los votos. El host no puede pausar unilateralmente. Mantenimiento técnico independiente, con aviso compartido y suspensión/reanudación del reloj. El tiempo se transmite por MQTT sobre WebSocket seguro (WSS); el cliente solo interpola. Guardados alternos verificados conservan el resto intradía y excluyen el tiempo offline al reiniciar/reconectar. | Sin pendientes dentro del alcance confirmado del bloque. La referencia temporal autoritativa pertenece al host de la partida, de acuerdo con la arquitectura activa; no existe un servidor central persistente y no se afirma que lo haya. No se añadieron velocidades no aprobadas. |
| 12. Multijugador y persistencia | **PARCIAL** | Máximo de 20 humanos, rechazo probado del jugador 21, varios miembros por gobierno, bloqueo de nuevas altas tras iniciar, guardado alterno local verificado y reconexión. `portable-backup.js` cifra copias portátiles con AES-256-GCM (PBKDF2-SHA-256, 310.000 iteraciones, salt/nonce aleatorios y datos autenticados); la importación valida formato, partida, sala, jugador anfitrión y token, instala la copia en la ranura alterna y verifica lectura. La UI exige confirmar que el anfitrión anterior está cerrado. | Sin nube, sincronización incremental remota, elección/transferencia automática de anfitrión ni garantía de recuperación cuando se pierde la contraseña o se modifica el formato. La copia portátil incluye credenciales de la partida: debe custodiarse como un secreto. |
| 13. Escenario inicial | **PARCIAL** | Registro versionado del escenario con 16 claves oficiales, semilla registrada, huella de integridad no criptográfica, IDs de Estado/moneda y auditoría de recetas, monedas y dependencias tecnológicas. | La semilla no genera todavía todo el mundo; la nueva partida solo funda economía/población inicial en el primer Estado; faltan depósitos geográficos, límites provinciales aprobados y tolerancias de balance demográfico/económico. |
| 14. Demografía | **PARCIAL** | Cohortes agregadas 0–120, tasas configurables, envejecimiento, nacimientos/mortalidad diaria con restos exactos y migración interna proporcional. `epidemiology.js` añade enfermedades solo declaradas en escenario, inicios fechados, redes de contacto entre grupos del mismo Estado, incubación, contagios, recuperación y muertes agregadas que descuentan población real de las cohortes por edad. El ciclo de servicios calcula por grupo la reducción de mortalidad a partir del acceso y la calidad sanitaria; demografía y epidemiología aplican ese mismo resultado a mortalidad ordinaria y epidémica. Las reglas de enfermedad y semillas están en la huella inicial del escenario; la evolución viva se replica en snapshots. Panel SOCIETY muestra pirámide, grupos, migraciones y vigilancia de brotes. | No hay enfermedades, tasas ni brotes por defecto. Falta migración exterior coordinada, urbanización/despoblación, esperanza de vida, causas generales de mortalidad, factores de empleo/vivienda/seguridad/familia/persecución y enlace de contactos derivados de movilidad real. La reducción sanitaria ya se calcula automáticamente desde acceso, capacidad/servicio y calidad, y se aplica a mortalidad demográfica y epidémica. Faltan familias y NPC relevantes, prevención, tratamiento, cuarentena y medidas públicas, validación histórica y balance epidemiológico. |
| 15. Justicia | **PARCIAL** | Denuncias no clasificadas, leyes vigentes, jurisdicción provincial, policía autorizada, investigación, pruebas, fiscalía, tribunal, veredicto, penas legales, prisión, recurso registrado e historial auditable. | Defensa y representación letrada, audiencias, asignación judicial separada, resolución de recursos, ejecución/liberación, prisión preventiva, derechos legales configurables, corrupción y estadísticas causales siguen pendientes. |
| 16. Servicios públicos | **PARCIAL** | services.js con educación, salud, servicios sociales y culturales; proveedores públicos/privados/religiosos/comunitarios/mixtos; financiación separada por tesorería y empresa operadora; personal, capacidad, calidad, agua y costes diarios. Cobertura por grupo con perfiles de distancia, tiempo, transporte, elegibilidad y asequibilidad; evita doble conteo entre centros. Salud reduce la tasa de mortalidad configurada; educación mejora cualificación laboral tras un retraso configurable. Panel SERVICES por Estado. | Hospitalización/camas, medicinas, prevención, epidemias, saturación sanitaria, mortalidad por causas, esperanza de vida, bienestar social, pensiones y cobertura de saneamiento aún no están completos. La configuración avanzada del anfitrión sigue siendo JSON. Sin datos configurados no se inventan porcentajes nacionales. |
| 17. Recursos, clima y medio físico | **PARCIAL** | resources.js integra agua finita por provincia, entrada renovable, caudal/extracción máxima, reserva ecológica, calidad y prioridades; agricultura/estaciones; depósitos minerales; energía y desastres; ganadería (hato, reproducción, mortalidad, alimento y productos), pesca estacional (stock, regeneración, cuota ecológica/sostenible y biodiversidad) y silvicultura (madera en pie, regeneración, conservación y tala sostenible). Las tres producciones se vinculan a instalaciones y empresas NPC y registran ciclos e inventarios. Panel RESOURCES. | Siguen pendientes caza, canales/embalses/redes completas de distribución, consumo industrial con integración de agua, daños físicos completos por desastres, recuperación ecológica integral, capas geográficas provinciales y respuesta pública/infraestructura ante riesgos. El clima y las cuotas requieren configuración real; no se inventan tasas ni depósitos. |
| 18. Empresas y trabajo | **PARCIAL** | industry.js vincula empresas NPC y sus instalaciones a puestos de trabajo, ocupaciones, cualificación, grupos de población, provincia, salarios, turnos, seguridad/exposición, capacidad de caja, nómina y balances de empleo. Los sindicatos reconocidos ponderan el salario negociado por afiliación. La educación puede elevar cualificaciones tras un retraso. El panel INDUSTRY expone vacantes, empleo, paro, nóminas, condiciones y representación laboral. | Propietarios/directivos y estrategia empresarial, quiebras/deuda, accidentes y recuperación, huelgas, salarios reales/IPC, automatización, patentes/licencias, negociación colectiva con procedimientos y concentración de mercado siguen pendientes. Jugadores no gestionan empresas individuales. |
| 19. Finanzas | **PARCIAL** | finance.js añade metadatos de moneda por Estado, cotizaciones FX explícitas con vigencia/fuente, conversión sin inferir pares, bancos NPC con liquidez/reserva/límite, deuda pública con interés diario y default, recaudación diaria de impuesto sobre ventas de empresas con atrasos, e índice de precios por cesta ponderada. Integrado en órdenes del anfitrión, ciclo diario, snapshot y huella estructural del escenario. Panel ECONOMY con cuentas, cotizaciones, bancos, deuda, impuestos e índice; endeudamiento reservado al cargo ejecutivo/tesorería. | Aún faltan depósitos/retiradas y préstamos privados, sucursales y regulación bancaria, crédito a empresas/hogares, cuotas y calendarios de amortización, garantías, impuestos con bases/exenciones/evasión múltiples, aranceles y seguros, balanza comercial/reservas, bolsa y acciones, política monetaria, lavado/fraude, crisis con contagio y decisiones de bancos/inversores. El IPC solo usa mercados y cesta explícita configurada; la deuda usa interés simple diario y vencimiento. No se inventan bancos, tipos, tasas ni valores iniciales. |
| 20. Diplomacia avanzada | **PARCIAL** | diplomacy-advanced.js amplía el mismo grafo diplomaticRelations: propuestas públicas de tratados con cláusulas, contraoferta estructurada desde la interfaz (cláusulas seleccionables, duración y nota no vinculante), aceptación/rechazo, vigencia, expiración, aviso de salida y terminación motivada; no agresión bloquea guerra. Organizaciones configurables por carta, miembros, competencias, quórum y umbral; resolución de embargo con un voto por Estado; sanción activada al siguiente día y conectada al bloqueo de rutas comerciales; conferencias con participantes representados y agenda. Los snapshots comparten solo datos públicos. | Siguen pendientes diplomáticos/embajadas y presupuestos, órganos y financiación de organizaciones, aprobación constitucional/judicial, reclamaciones y reconocimiento, mediación/arbitraje/operaciones de paz, normativa/jurisdicción internacional, relación multidimensional, cooperación operativa más amplia y excepciones/seguimiento de sanciones. Negociación secreta sigue deshabilitada porque el snapshot compartido aún no filtra por destinatario. Solo se implementa el embargo comercial entre sanciones. |
| 21. Administración pública | **PARCIAL** | bureaucracy.js opera agencias y departamentos separados de los cargos políticos, funcionarios, mérito/patronazgo, competencias y jurisdicciones provinciales, presupuestos, nóminas y atrasos, tareas creadas por leyes/procedimientos, capacidad afectada por personal/infraestructura/coordinación/corrupción/carga, recepción de documentos, proyectos, hitos y auditoría. Se añadió contratación pública operativa: publicación de licitación ligada a una agencia/provincia/competencia, reserva previa del presupuesto, registro de ofertas de proveedores existentes, cierre por fecha, adjudicación determinista a la oferta válida más baja, recepción de entrega, inspección por oficina/persona distinta, pago tras aceptación y cancelación motivada con devolución de reserva. Nóminas y tareas no pueden consumir fondos reservados. La UI expone el ciclo y oculta acciones no autorizadas. | No hay publicación electrónica externa, descubrimiento automático de proveedores, marco jurídico de contratación completo, fiscalidad contractual ni evaluación multicriterio configurable. También faltan formación, errores y sobrecarga causal completa, transferencia efectiva de competencias por descentralización, licencias/censos/archivos/servicios postales y administración civil completa de territorios ocupados. |
| 22. Medios e información | **PARCIAL** | media.js y panel MEDIA: medios con propiedad/editorial/alcance/credibilidad/independencia, cobertura temática y editores activos; artículos diferenciados (noticia debe citar eventos existentes del mismo Estado), encuestas de respuestas agregadas, opinión pública gradual, capacidad diaria, archivo a 14 días y restricciones censoria únicamente con ley vigente y oficina competente. | Propaganda con campañas y presupuesto, rumores con incertidumbre y rectificación, red postal/distribución por alfabetización/transporte/coste/idioma, periodistas NPC, reputación/financiación y broadcast internacional completo. La configuración del escenario requiere datos explícitos; no se inventan outlets ni opiniones base. |
| 23. Inteligencia y seguridad | **PARCIAL** | security.js y panel SECURITY: agencias y mandatos legales por provincia/competencia, reportes de incidentes no presuntivos, investigaciones con capacidad, informes con confianza/clasificación y fuentes del registro local, warrants aprobados por oficina judicial separada, supervisión independiente, remisión a justicia y alertas públicas con expiración. El snapshot compartido ahora retira agencias, casos, informes clasificados, solicitudes, warrants, órdenes security.* y eventos security.*; la vista local del anfitrión filtra registros/órdenes/eventos por sus membresías activas. | No hay agentes ni operaciones encubiertas, secretos compartidos de forma autenticada por destinatario, red de fuentes, contrainteligencia avanzada, cifrado de extremo a extremo, interceptación/códigos, inteligencia militar/económica/tecnológica ni filtración causal integrada. El relay MQTT no ofrece ACL por jugador: no se transmite información clasificada a invitados hasta disponer de un canal privado realmente autenticado/seguro. El host-local no sustituye la entrega privada multiplayer. |
| 24. Eventos causales | **PARCIAL** | world-events.js evalúa condiciones declarativas AND/OR sobre métricas observadas del mismo Estado y día: demanda no satisfecha, déficit de agua, defaults de deuda, derrotas militares, alertas públicas y epidemiología agregada (exposiciones, infecciones, muertes, casos activos y brotes activos). Guarda evidencia y tirada determinista, diagnostica por qué no se produjo un evento y expone la causa en el panel EVENTS. Los reportes privados de seguridad siguen fuera de los disparadores públicos. | Faltan causas observadas de tensión diplomática, protestas, sucesiones y descubrimientos; crisis agrupadas/escaladas, aniversarios, arqueología/memoria cultural y consecuencias multi-sistema amplias. No se inventan definiciones ni umbrales para mundos nuevos. |
| 25. Religión, ideología e identidad | **PARCIAL** | `identity.js` ya valida grupos y perfiles agregados por provincia, afiliaciones solapadas/exclusivas, organizaciones comunitarias, mandatos legales y oficinas autorizadas; calcula indicadores agregados de cohesión/polarización, registra programas financiados y conserva snapshots diarios. | Las entidades específicas Religion/ReligiousInstitution/ReligiousOffice/Ideology/PoliticalMovement/CulturalIdentity/NationalIdentity/MinorityStatus aún no tienen flujos operativos. Faltan reglas constitucionales ejecutables de religión-Estado, privacidad diferenciada por institución, sucesión/cisma/financiación religiosa completa, preferencias ideológicas multidimensionales conectadas con partidos, transmisión cultural, minorías y derechos, conversiones voluntarias/coaccionadas, difusión contextual y conflictos causales con efectos en seguridad/justicia/migración/diplomacia. El catálogo ideológico y tasas/factores finales siguen pendientes; los efectos actuales de programas comunitarios son provisionales y requieren aprobación/balance. No se inventan grupos iniciales ni creencias de jugadores humanos. |

## Cambios locales verificados en esta fase

1. Límite real del cliente: 20 jugadores; el 21 se rechaza sin incorporarlo al roster.
2. Al cambiar la lista de jugadores conectados durante una votación, todos los votos pendientes se reinician y queda un evento auditable.
3. Catálogo inicial de 16 Estados oficiales con claves estables separadas del GUID de la partida.
4. Migración de etiquetas antiguas solo cuando coinciden exactamente con el catálogo heredado; conserva IDs de territorio, propietarios, tesorerías y edificios.
5. Capacidad de lobby anunciada en snapshots y avisos de aforo, con límite máximo aunque un guardado antiguo anuncie 100.
6. UX local previa: leyes mediante tarjetas y deslizadores, presupuesto mediante deslizador y ajustes rápidos, accesos HUD independientes para BUILD y CITY, ECONOMY, GOV y PAUSE.
7. Bloque 7 (fase cartográfica): registro `territory-geometry.js` v1 con 16 claves oficiales, 16 IDs SVG explícitos, nombres de escenario y huellas SHA-256; selección y resaltado consumen el registro externo. Se añadieron capas de soberanía y control efectivo sin editar `map.svg`. Las geometrías provinciales siguen sin inventarse: cada path disponible delimita un Estado.
8. Bloque 8 (investigación): filtros para los 12 dominios especificados, tarjetas del árbol generadas desde el snapshot y estados visibles; pruebas de requisitos previos, personal, financiación privada, finalización, descubrimiento y rechazo de una adopción duplicada.
9. Bloque 9 (gobierno avanzado): el panel muestra competencias reales, institución, permisos de propuesta/voto, aprobación, mínimo de votos, umbral y fundamento legal. Cámaras, elecciones y fiscalización se marcan como no configuradas en vez de simularlas.

## Verificación ejecutada

- En la auditoría anterior de bloques 13–15 el cliente activo obtuvo 93/93. La actualización posterior de bloques 16–18 se registra por separado al final de este documento.
- Referencia heredada .NET 8: **186/186 pruebas superadas**. Estas pruebas no validan por sí mismas la web activa.
- Integración simulada de transporte: 20 jugadores admitidos, 21 rechazado; snapshot sin fanout completo por cada alta.
- Integración de pausa: una salida de jugador reinicia una votación incompleta sin pausar indebidamente el mundo.
- Integración de escenario: migración idempotente de las 16 identidades.
- `git diff --check` en los archivos modificados en esta fase: sin errores. El diff completo de NewWorld aún señala un espacio final en una línea de `tests/multiplayer-load.test.cjs`, un archivo modificado en la fase anterior y no alterado aquí.
- Navegador local: registro cartográfico cargado, 16 geometrías reconocidas, 16 colores de soberanía y control, selección SVG de Chungia verificada; el árbol de investigación cargó cuatro tecnologías y cinco proyectos, filtró agricultura/construcción y mostró correctamente dominios vacíos; el panel de gobierno mostró tres competencias y marcó parlamento, elecciones y fiscalización como pendientes, sin errores JS.
- Prueba `territory-geometry.test.cjs`: integridad SHA-256, unicidad de claves/IDs, cobertura de 16 Estados y rechazo de límites provinciales inferidos.
- SHA-256 del SVG original: `ED01509FE3C4BA9933755287E8256617505780851FBF6379B087FA5463C669EB`; no se ha modificado.

## Límites de esta entrega

- Los cambios están en el equipo local, no publicados.
- No se han creado commits ni despliegues.
- No se consideran completos los 25 bloques: los estados **PARCIAL** y **PENDIENTE** indican trabajo real que aún falta.
- No se han inventado parámetros de demografía, recursos, ideologías, conversiones o eventos para aparentar que existen sistemas terminados.


## Actualización de los bloques 10–12 — 8 de noviembre de 2026

### Bloque 10 · Interfaz principal — sigue PARCIAL

- Se añadió una bandeja única de **órdenes y alertas** en la cabecera. Consume eventos del mundo y órdenes locales pendientes, no un feed ficticio independiente.
- Los eventos se agrupan por tipo, Estado y fecha; el número junto a INBOX cuenta entradas sin leer. Los tipos rutinarios de cada ciclo se excluyen para evitar ruido.
- Cada entrada muestra categoría, prioridad visual, fecha, origen, texto y acción. Al abrirla, marca sus eventos como leídos, selecciona el Estado asociado cuando existe y abre el área funcional correspondiente.
- El estado de lectura se guarda por partida y jugador en el almacenamiento del navegador; el registro queda limitado a los 500 identificadores recientes. Las órdenes aún pendientes continúan visibles hasta recibir confirmación o retirarlas.
- Se añadieron apertura/cierre por teclado, Escape, restauración del foco, nombres accesibles, anuncios de cambios y estados vacíos explícitos.
- El perfil de cabecera representa únicamente la identidad de jugador de la sesión y abre sus ajustes. No se presenta como una cuenta autenticada ni como un servicio de perfiles.
- La cabecera ahora identifica el Estado seleccionado y la conexión. El indicador del reloj es una representación visual; no concede autoridad al cliente.
- Se corrigió el ancho responsive de la cabecera: a 390 px el documento, el cuerpo y la cabecera caben en 390 px; la bandeja abierta mide 378 px. La navegación mantiene su propio desplazamiento horizontal.
- Pendiente: preferencias/perfiles persistentes entre dispositivos, políticas de notificación por permisos, auditoría completa de accesibilidad y todos los flujos por rol. No se considera terminado.

### Bloque 11 · Reloj y simulación — sigue PARCIAL

- Se formalizó el día de simulación como **300.000 ms (cinco minutos) a velocidad 1x**. No se añaden velocidades alternativas que no estén definidas por la especificación.
- El acumulador ya no descarta el tiempo transcurrido al limitar el intervalo a cinco minutos. Procesa hasta 24 días por pulso y conserva el resto como trabajo pendiente para el siguiente pulso.
- Los días se ejecutan en orden y no se adelanta el calendario del cliente invitado. Si una simulación falla, el anfitrión pausa el mundo, registra el error y no consume el día que no pudo completar.
- El anfitrión transmite una muestra del acumulador. El cliente invitado interpola exclusivamente la barra visual; no avanza fecha, día, economía ni población.
- Al restaurar una partida, se recupera el acumulador guardado y se reinicia la referencia temporal real. El tiempo que el navegador/equipo estuvo apagado no se añade a la partida.
- La partida se pausa si el anfitrión pierde la conexión; los votos se reinician cuando cambia la lista de jugadores conectados. También hay pausa explícita cuando no queda ningún jugador conectado en el mundo del anfitrión.
- Pendiente: pruebas de estrés prolongadas con suspensión real del sistema, límites de almacenamiento bajo mundos muy grandes y auditoría determinista de todos los subsistemas ejecutados por día. No se considera terminado.

### Bloque 12 · Multijugador y persistencia — sigue PARCIAL

- El guardado del anfitrión utiliza dos ranuras locales alternas, con formato y versión de esquema, generación, identificadores de partida/sala/anfitrión, acumulador del reloj y estado completo.
- Cada copia nueva se escribe en la ranura alterna, se vuelve a leer y se valida antes de declararla correcta. La última copia válida anterior se conserva. La recuperación escoge la generación válida más alta, no confía en el puntero auxiliar y puede recuperarse de una copia reciente dañada.
- Se mantiene lectura de guardados heredados v2 si no hay una ranura v3 recuperable y el guardado antiguo supera la validación.
- El checksum FNV se usa para detectar corrupción accidental del contenido; **no es una firma criptográfica ni una defensa frente a un atacante que pueda modificar el almacenamiento**.
- Los snapshots incrementales utilizan versión base y versión nueva. Solo se envían cuando todos los invitados conectados anuncian compatibilidad y el delta es sustancialmente menor que el snapshot completo.
- El invitado rechaza deltas con base equivocada, ruta insegura o estructura inválida. Solicita resincronización cuando pierde un delta; el anfitrión verifica partida, jugador, token y conexión y envía un snapshot completo por el canal privado.
- Los clientes antiguos siguen recibiendo snapshots completos. Unirse, reconectar o restaurar una sesión vuelve a establecer una base completa antes de continuar con deltas.
- Límite explícito: el guardado sigue estando en el perfil local del navegador del anfitrión. Dos ranuras no equivalen a una copia externa; perder el perfil/equipo o agotar la cuota local puede impedir la recuperación. No hay recuperación en nube ni continuidad cuando el anfitrión está apagado.
- Pendiente: copias externas verificadas, migraciones de esquema adicionales, límites prácticos con estados enormes y una arquitectura de servidor persistente independiente del anfitrión. No se considera terminado.

### Pruebas nuevas de esta actualización

- Envoltorio de guardado: lectura/verificación de checksum, fecha inválida, jugadores duplicados y sesión que no corresponde al anfitrión.
- Recuperación integrada: se corrompe deliberadamente la ranura más reciente y se comprueba que se restaura la anterior válida y se reconstruyen dos copias válidas.
- Reloj integrado: 299 s, 300 s, 301 s, retraso de más de 24 días y drenaje del trabajo pendiente en el siguiente pulso.
- Reloj invitado: la interpolación alcanza el 50 % de un día sin modificar el día autoritativo del snapshot.
- Deltas: cambios anidados y arrays, inmutabilidad de la base, rechazo de versiones/rutas inseguras, pérdida deliberada de un delta y resincronización autenticada.
- Compatibilidad: un cliente antiguo continúa recibiendo snapshots completos y nunca recibe mensajes delta.
- Navegador local: carga de cabecera, bandeja, mapa y controles de perfil; apertura/cierre con Escape; 16 geometrías registradas y validadas; bandeja abierta en viewport de 390 px sin desbordamiento horizontal; sin excepciones JavaScript en la pasada final.



## Actualización del bloque 15 — Justicia y orden público — 8 de noviembre de 2026

**Estado actualizado: PARCIAL.** El subsistema judicial ya está integrado en el cliente web y en las órdenes autoritativas del anfitrión. No se declara terminado el bloque.

### Implementado y probado

- Registro de denuncias no clasificadas por provincia y Estado. Una denuncia no genera por sí sola un delito, culpabilidad ni sanción.
- Catálogo de tipos delictivos ligado a IDs de leyes existentes; la investigación comprueba que la ley esté aprobada, vigente en la fecha del hecho y no derogada.
- Jurisdicción provincial explícita para policía y tribunales. Las agencias requieren personal y cargos políticos autorizados; la selección visual solo muestra jurisdicciones compatibles.
- Investigación, asignación de tribunal y límite de capacidad judicial.
- Registro de pruebas con tipo, descripción, autor y fecha. Las pruebas se marcan como no verificadas; no se interpreta automáticamente su fiabilidad.
- Acusación separada de la investigación: requiere fiscal autorizado, número mínimo de pruebas configurado y una persona distinta del investigador.
- Veredicto separado de acusación: exige cargo judicial autorizado, ausencia de conflicto de interés y umbral probatorio definido por el escenario para una condena.
- Sentencia separada de condena: exige cargo competente y una pena declarada en la ley aplicable; se validan límites de multa/reparación o duración y capacidad penitenciaria.
- Recurso: comprueba cargo autorizado y plazo configurado y conserva el expediente; el estado de recurso se registra, pero la revisión y resolución de apelación todavía no están implementadas.
- Registro de actividad y eventos de cada etapa, con referencias al expediente y a su fundamento legal.
- Configuración de escenario validada para los 16 Estados, referencias existentes, cargos y provincias reales del escenario. Las instituciones sin configurar permanecen vacías.

### Límites que siguen pendientes

- Defensa, representación letrada, acceso de la defensa al expediente, audiencias, interrogatorio y calendario procesal.
- Revisión y sentencia de segunda instancia; no basta con registrar que se presentó un recurso.
- Ejecución económica de multas/reparaciones, liberación y avance temporal de condenas y otras sanciones.
- Delitos agregados/estadísticas, detención preventiva, garantías, inspección, corrupción institucional y revisión externa.
- Integración causal con burocracia, medios, derechos civiles y opinión pública.
- La interfaz de configuración avanzada de instituciones conserva un editor JSON técnico para el anfitrión. El flujo de juego ordinario sí utiliza controles y botones; el configurador completo no se ha convertido todavía a un asistente visual.

### Pruebas

- justice.test.cjs: **10/10 pruebas superadas**. Incluye cobertura de 16 Estados, referencias legales y jurisdiccionales, denuncias sin presunción de culpabilidad, autorización policial, separación entre fiscal e investigador, conflicto judicial, umbrales de condena, límites de sanción, plazo de recurso, capacidad de tribunal y prohibición de retroactividad.
- Cliente completo: **93/93 pruebas Node superadas** tras integrar escenario, demografía y justicia.
- node --check correcto en scenario.js, demography.js, justice.js, simulation.js, strategy.js, multiplayer.js y game.js.
- Prueba Puppeteer de navegador: 11 vistas y tres módulos cargados; panel SOCIETY abre al pulsar su pestaña; anchuras de 1440 px y 390 px sin desbordamiento; cero errores JavaScript. Queda pendiente probar las etapas judiciales en una sesión multijugador de dos clientes.

Los sistemas de justicia de cada Estado no se rellenan con códigos penales, penas, órganos, plazos o cargos inventados. Hasta que el escenario defina esos elementos, el juego permite registrar incidentes pero bloquea las etapas que no tengan fundamento y autoridad configurados.


## Actualización de los bloques 13–15 — 8 de noviembre de 2026

### Bloque 13 · Escenario inicial — PARCIAL

- Se incorporó scenario.js, módulo versionado del escenario activo.
- El registro incluye identidad y versión del escenario, fecha de fundación, semilla declarada, las 16 claves oficiales, IDs de Estado y moneda, semilla derivada por Estado, registro cartográfico y huella de integridad.
- La huella se identifica expresamente como fnv1a32-noncryptographic: detecta cambios accidentales en los datos incluidos, pero no es una firma criptográfica ni acredita autenticidad frente a manipulación deliberada.
- La auditoría valida identidades e índices oficiales, referencias de monedas, integridad de recetas y bienes, y ciclos en el árbol de prerrequisitos tecnológicos. Informa por separado de advertencias sobre datos geográficos, demográficos, económicos y perfiles políticos ausentes.
- El registro inicial se valida al crear y arrancar el mundo. La fecha de inicio queda fijada en el registro: el paso de días no invalida la huella. Los IDs de Estado y moneda y las semillas derivadas se verifican al restaurar/consultar el registro.
- Se probó que la función de economía inicial puede crear redes independientes para cada uno de los 16 Estados solicitados. La creación real de una partida nueva aún solo funda la población y la economía de inicio en el primer Estado; el resto queda sin población inicial y sin economía local sembrada.
- Pendiente: generación determinista integral usando la semilla; distribución inicial aprobada de población y actividad; balance cuantitativo por geografía; depósitos de recursos documentados; límites provinciales reales; correspondencia completa entre mapa y provincias. La propia auditoría marca estas carencias. No se han añadido tasas, poblaciones ni depósitos históricos inventados.

### Bloque 14 · Demografía — PARCIAL

- demography.js incorpora grupos agregados y cohortes por edad, sin filas individuales para cada residente.
- La configuración exige perfiles de Estado únicos, natalidad anual configurable, bandas de mortalidad contiguas que cubran las edades 0–120, ubicaciones para grupos y suma exacta de cohortes = grupo = población estatal.
- El ciclo diario conserva restos de división con enteros grandes para que las tasas anuales configuradas no pierdan población por redondeo repetido. Las cohortes envejecen una vez al cambiar el año; nacimientos y muertes actualizan el total y producen eventos agregados con causa configurada.
- La interfaz SOCIETY muestra población, nacimientos, muertes, traslados recientes, pirámide de edades, grupos, historial demográfico y controles de migración interna mediante selectores, deslizador y botón.
- El traslado requiere permiso de la membresía, dos grupos y ubicaciones diferentes dentro del mismo Estado. La asignación proporcional de edades usa restos mayores; se comprueban las sumas y los límites enteros antes de modificar ambos grupos. La operación genera registro y evento, y conserva exactamente la población conjunta.
- En los Estados sin perfil demográfico configurado continúa el crecimiento heredado del asentamiento. No se afirma que esos Estados tengan cohortes demográficas completas.
- Pendiente: perfiles y edades iniciales aprobados para cada Estado, migración exterior, epidemias, exposición/infección/recuperación, factores de salud y saneamiento, natalidad/mortalidad causal por servicios/empleo/seguridad, urbanización, despoblación y cálculo de esperanza de vida. No se inventan valores por defecto.

### Bloque 15 · Justicia — PARCIAL

- El modelo está en justice.js y conserva los campos de snapshot activos: justiceSystems, justiceReports, justiceCases y justiceHistory.
- Los 16 Estados reciben estructuras vacías y pendientes. Una configuración se activa solo cuando declara delitos, tribunales, policía y prisiones; una configuración parcial no puede activarse.
- Las denuncias almacenan provincia, descripción y fecha del hecho, pero permanecen sin clasificar y no generan automáticamente una causa ni presunción de culpabilidad.
- La ley penal debe existir, estar promulgada y encontrarse vigente en la fecha denunciada. Se añadieron pruebas que bloquean la aplicación retroactiva de leyes con fecha de entrada en vigor posterior al hecho.
- Investigación, registro de prueba, acusación, veredicto, sentencia y recurso tienen controles separados de etapa, jurisdicción, cargos, capacidad, conflicto de interés y fundamento legal. La fiscalía debe ser distinta del investigador; un juez no puede decidir un expediente en el que haya intervenido.
- Las penas deben figurar en el tipo de delito aplicable; se validan los límites de multas/reparaciones, duración de prisión y capacidad penitenciaria. La apelación queda registrada con su plazo y cargo autorizado, pero todavía no dispone de un procedimiento de segunda instancia que resuelva el recurso.
- Pendiente: defensa y asistencia letrada, audiencias, interrogatorio, asignación judicial como fase independiente, revisión de apelaciones, prisión preventiva, cumplimiento/liberación de condenas, garantías legales configurables y efectos de corrupción/mercados ilegales. La configuración avanzada del anfitrión sigue usando JSON técnico. No se han inventado delitos, penas, derechos ni cargos.

### Verificación de los bloques 13–15

- Cliente web activo: **93/93 pruebas Node superadas**, incluidas 10 pruebas de justicia y 7 de demografía y escenario.
- node --check: correcto en los siete módulos activos comprobados.
- git diff --check: limpio en los archivos intervenidos en esta fase. El repositorio conserva un espacio final preexistente en una línea de tests/multiplayer-load.test.cjs, que no se ha tocado.
- Navegador local mediante Puppeteer: HTTP 200; vista SOCIETY presente y operativa al hacer clic; scenario.js, demography.js y justice.js cargados; los 10 nodos del panel social/auditoría existen; 11 vistas detectadas; 1440 px y 390 px sin desbordamiento horizontal; cero errores de página y consola.
- No se ha probado todavía la experiencia judicial completa entre dos clientes reales ni se ha simulado la caída del anfitrión durante un procedimiento.
- Todos los cambios siguen locales. Sin commit, push ni publicación.

## Actualización del bloque 17 — Recursos, clima y medio físico — 8 de noviembre de 2026

**Estado: PARCIAL.** El subsistema ya tiene un ciclo diario real conectado al anfitrión, snapshots compartidos y órdenes autoritativas. No se considera terminado el bloque.

### Implementado

- Catálogo de recursos con unidad, categoría, mercado de salida, renovabilidad y regeneración configurable.
- Depósitos con reservas finitas, calidad, capacidad diaria, extracción sostenible, degradación de calidad, provincia, instalación, trabajadores mínimos, ley de extracción y cargos autorizados.
- Extracción por deslizador en el panel RESOURCES. La acción se valida en el anfitrión: no basta con que el control visual esté habilitado.
- La extracción comprueba la vigencia de la ley, jurisdicción, cargo del jugador, existencia y operatividad de la instalación, plantilla, tecnología exigida, reservas, límite diario, energía, fondos y almacenamiento.
- La operación revierte energía, fondos, existencias y reservas si el almacenamiento no admite todo el lote; no deja una extracción parcial cobrada.
- Regeneración de recursos renovables limitada a la capacidad del depósito. Los minerales no se regeneran.
- Parcelas agrícolas, cultivos, calendario mensual/de cosecha, semillas, trabajadores/hectáreas, herramientas, infraestructura, agua y fertilidad del suelo.
- Producción estacional derivada de factores configurados por zona climática; limita superficie productiva por tierra, mano de obra y semillas disponibles.
- Estado ambiental separado por provincia: fertilidad, disponibilidad de agua, cobertura forestal, biodiversidad e índice de contaminación.
- Desastres configurables con fecha y duración, aplicados solo a provincias indicadas. La exposición a sequía se modula por zona climática explícita y el daño diario no se repite.
- Balance energético diario, con capacidad, producción, pérdidas, consumo previo y energía disponible/consumida por extracción.
- Existencias compartidas de bienes producidos, cosechas, historial de impactos y reservas estratégicas protegidas.
- Panel RESOURCES: depósitos, existencias, tierra, granjas, clima/estación, cosechas, medidas ambientales, energía, desastres e historial. Los valores no configurados se muestran como ausentes, no se inventan.

### Límites pendientes

- Consumo de agua por hogares, agricultura, industria y servicios; acuíferos, ríos, tratamiento, distribución y escasez.
- Silvicultura con replantación, ciclos de crecimiento y tala; pesca con poblaciones y cuotas; ganadería y fertilidad/uso de pastos.
- Efectos completos de contaminación, residuos, vertidos, erosión, biodiversidad, salud y restauración ambiental.
- Sequías, inundaciones, incendios, tormentas y terremotos con pronóstico, protección civil, infraestructuras dañadas, evacuaciones y recuperación.
- Energía interconectada con toda la producción, red y demanda de edificios/servicios; el balance ya alimenta la extracción, pero no es aún una red eléctrica integral.
- El anfitrión todavía configura los datos avanzados mediante JSON; el flujo ordinario de extracción utiliza controles. Falta un asistente de escenario visual para configurar recursos y clima.

### Verificación

- resources.test.cjs: **9/9 pruebas superadas**. Incluye validación de referencias, extracción finita, límites diarios y agotamiento, regeneración, cosecha estacional y por mano de obra, daños localizados por sequía, reservas protegidas y rollback atómico ante falta de almacenamiento.
- Suite del cliente activo: **102/102 pruebas Node superadas** el 8 de noviembre de 2026.
- node --check correcto para resources.js, simulation.js, multiplayer.js, justice.js y game.js.
- No se ha ejecutado una prueba visual de navegador ni una partida real de dos clientes para el nuevo panel; no se afirma esa cobertura.
- Los cambios continúan locales, sin commit ni despliegue.

Los datos de reservas, cultivos, rendimientos, clima, desastres y energía deben ser aprobados y configurados para el escenario. El sistema no asigna depósitos o valores históricos ficticios para aparentar que el bloque está completo.


## Actualización de los bloques 16–18 — 8 de noviembre de 2026

### Bloque 16 · Servicios públicos — PARCIAL

- Se incorporó services.js con tipos de servicio separados por educación, salud, asistencia social y cultura.
- Los centros públicos, privados, religiosos, comunitarios y mixtos deben estar asociados a un Estado, provincia, grupos de población y, cuando corresponde, empresa NPC operadora con la moneda del Estado.
- Se separan los costes públicos (tesorería) de las aportaciones del operador privado (caja y libro de empresa). La capacidad efectiva depende de personal disponible, fondos, calidad y agua configurada.
- La cobertura se calcula por grupo con un perfil explícito de distancia, tiempo de viaje, transporte, elegibilidad y asequibilidad. Necesidad total, población alcanzable y atención prestada se muestran por separado; dos centros no cuentan dos veces a los mismos residentes.
- La salud reduce la tasa de mortalidad configurada y la educación añade progreso al índice educativo y a la cualificación laboral después del retraso definido por el escenario.
- La vista SERVICES muestra centros, ubicación, plantilla, capacidad, calidad, costes, cobertura por grupo e historial de restricciones. El anfitrión puede configurar los registros avanzados; el resto de jugadores consulta los resultados.
- Pendiente: hospitales con camas y ocupación, medicamentos, prevención, saturación epidémica, estadísticas sanitarias por causas, esperanza de vida, bienestar social, pensiones y una red de saneamiento completa. El sistema de acceso no equivale a un modelo médico integral. El editor de configuración del anfitrión sigue siendo JSON técnico.

### Bloque 17 · Recursos, clima y medio físico — PARCIAL

- Se amplió resources.js sin sustituir el sistema anterior de depósitos, minería, energía, agricultura, clima, reservas estratégicas ni desastres.
- El agua dispone de fuentes provinciales, stock/capacidad, entrada renovable, extracción máxima, reserva ecológica, calidad y demandas con prioridad. La asignación es local, deja registro de reservas y faltantes y no permite extraer el volumen ecológico protegido.
- Se añadieron tres registros primarios independientes:
  - Ganadería: pastos vinculados a parcelas, tamaño de hato, capacidad de carga, reserva reproductiva, nacimientos/mortalidad configurados, alimentación desde inventario, personal, productos diarios y sacrificio limitado.
  - Pesca: caladeros por provincia, stock finito, regeneración, temporada mensual, cuota máxima/sostenible, reserva ecológica y posible impacto en biodiversidad.
  - Silvicultura: parcelas de bosque, madera en pie, regeneración, reserva ecológica, límites de tala, capacidad de personal y efecto sobre cubierta forestal.
- Cada instalación debe enlazarse a una instalación real de una empresa NPC y sus productos entran en el inventario de esa empresa. La producción se registra por ciclo, y el mismo día no se procesa dos veces.
- La huella del escenario registra parámetros iniciales de depósitos, agua, suelo, cultivos, clima, ganado, pesca, bosques y línea base ambiental; los cambios normales de stock no invalidan la versión original.
- La vista RESOURCES incluye paneles de ganadería, pesca, silvicultura, agua, reservas, agricultura, energía y medio ambiente.
- Pendiente: caza, canales/embalses y redes completas de distribución, consumo industrial de agua integrado en todos los puestos, daño y reconstrucción de edificios/redes por desastre, recuperación ecológica integral, capas geográficas provinciales y respuesta pública a riesgos. El escenario aún requiere configuración explícita; no se inventan masas de agua, reservas, estaciones ni cuotas.

### Bloque 18 · Empresas y trabajo — PARCIAL

- Se incorporó industry.js, separado de la gestión política y de los sistemas de construcción.
- Las empresas siguen siendo NPC. Un puesto de trabajo referencia una empresa y una instalación ya existentes, un Estado, una provincia, una ocupación y grupos de población locales.
- Las bolsas laborales declaradas no pueden superar la población del grupo; cuando la población cae, la oferta efectiva se reduce proporcionalmente y no aparecen trabajadores ficticios.
- La contratación compara ocupación y cualificación; las vacantes se limitan por personal disponible y caja real de la empresa. Las nóminas se cargan en la moneda local del negocio y se registran como transacciones empresariales.
- Los sindicatos reconocidos pueden establecer una referencia salarial; el salario efectivo pondera el salario pactado según afiliación. La plantilla enlazada se actualiza en las instalaciones NPC y repercute en la producción posterior.
- El panel INDUSTRY muestra oferta laboral, empleo, desempleo, tasa de empleo, puestos, salarios, nóminas, cualificación, jornada, seguridad, exposición y sindicatos.
- Pendiente: huelgas, accidentes y bajas con recuperación, propietarios/directivos y estrategia empresarial, crédito/quiebra/deuda, salarios reales con IPC, patentes y licencias, automatización y concentración de mercado. La negociación sindical no equivale todavía a un procedimiento completo de negociación colectiva.

### Verificación de los bloques 16–18

- Módulos afectados: node --check correcto en resources.js, services.js, industry.js, simulation.js, multiplayer.js, scenario.js y game.js.
- Suite específica de escenario, recursos, servicios e industria: **35/35 pruebas superadas**.
- Las pruebas nuevas cubren acceso por distancia/tiempo/transporte/elegibilidad/asequibilidad, doble cobertura, retraso educativo, contabilidad pública/privada, reservas ecológicas de agua, ganadería, pesca estacional, silvicultura, inventarios de empresas y repetición idempotente de los ciclos.
- Suite global de tests/*.test.cjs: **162 aprobadas / 6 fallidas de 168** en esta pasada. Las seis fallas observadas pertenecen a pruebas de otros bloques:
  - 2 de burocracia (submit is not defined dentro de bureaucracy.test.cjs).
  - 1 de identidad (identity.test.cjs no puede cargar identity.js en el árbol local).
  - 2 de medios (validación de muestras de encuesta y una comparación decimal exacta).
  - 1 de seguridad (warrant expirado/denegado/desajustado).
  Estas pruebas no corresponden a los módulos 16–18; no se han modificado sus archivos.
- Los cambios siguen locales en feature/new-world-city-controls, sin commit, push ni despliegue.

### Bloque 19 · Comercio, divisas y finanzas — PARCIAL

- Se añadió finance.js como extensión del registro económico y de monedas por Estado. No crea una segunda tesorería ni reescribe los IDs de moneda. El anfitrión debe declarar los metadatos de moneda (nombre, código único y escala decimal), pares FX con fecha efectiva/final, cotización, método y fuente, bancos NPC, reglas tributarias y cestas de precios.
- La conversión de divisas solo utiliza una cotización directa registrada y vigente en la fecha solicitada. No se invierten pares ni se deduce un tipo cruzado automáticamente. Las cuentas, bancos y deuda deben compartir exactamente la moneda del Estado; no se permite financiar una cuenta mediante conversión implícita.
- Se añadieron bancos NPC con caja, capital, reserva mínima, límite de crédito y exposición a principal moroso. Una emisión de deuda comprueba liquidez disponible y límite frente a la exposición vigente, carga la tesorería estatal y reduce la caja del acreedor. Al vencimiento, el principal restante entra en default y queda registrado como activo moroso del banco.
- Los intereses de deuda pública se acumulan diariamente sobre el principal pendiente mediante puntos básicos anuales y divisor real de 365/366 días, conservando el resto fraccionario para no perder precisión. La amortización descuenta primero intereses y después principal, y transfiere el importe real al banco.
- La recaudación fiscal disponible se limita deliberadamente al impuesto diario sobre volumen de ventas de empresas NPC. Si la caja de la empresa no cubre la cuota, se paga parcialmente y el resto pasa a atrasos por regla fiscal. Cada evaluación y pago queda registrado en los libros de empresa y de tesorería.
- El índice de precios es una cesta explícita de productos de mercados locales: cada peso debe sumar exactamente 10.000 puntos básicos y se compara el precio observado con el precio base declarado. No existe una inflación aleatoria independiente del mercado.
- Se añadió el panel de cuentas, cotizaciones, bancos, deuda, recaudación e índice al área ECONOMY; la conversión directa está disponible en el motor, no como formulario visual independiente. Las órdenes de emitir y amortizar deuda requieren titularidad ejecutiva/tesorería configurada y pasan por la cola autoritativa del anfitrión.
- Pendiente: depósitos de clientes, préstamos privados y empresariales, sucursales, regulación prudencial, calendario de cuotas, garantías, múltiples bases y exenciones fiscales, aduanas/aranceles, seguros comerciales, bolsa operativa, política monetaria, balanza exterior y reservas, fraude/lavado, crisis sistémicas y propagación completa de defaults a empleo y producción. La financiación disponible no representa todavía un sistema bancario universal. No se han inventado cifras iniciales.

### Bloque 20 · Diplomacia avanzada y derecho internacional — PARCIAL

- Se amplía el grafo diplomaticRelations, el que ya utiliza el bloque 5. No se crea una segunda base de relaciones. Las organizaciones internacionales se configuran mediante carta, Estados miembros, competencias, quórum, umbral de votación y estado operativo.
- Las propuestas de tratado separan las notas de negociación —que no producen efectos— de cláusulas estructuradas. La otra parte puede aceptar o rechazar; el motor también conserva el formato de contraoferta. La aceptación crea un tratado programado para el día siguiente, con duración, cláusulas, fecha de expiración, aviso de terminación y salida motivada.
- Se incorporó vencimiento automático de propuestas no respondidas. Una cláusula activa de no agresión bloquea una declaración de guerra entre las partes. Las cláusulas de paz pueden cerrar una relación bélica cuando entra en vigor el tratado; las restantes se conservan como obligaciones estructuradas, pero todavía no tienen todos sus efectos económicos/jurídicos.
- Las resoluciones de embargo requieren competencia de sanciones en la carta de la organización y un voto por Estado miembro. Al aprobarse, la sanción queda programada para el día siguiente y bloquea rutas comerciales cuyo origen o destino sea el Estado sancionado, salvo bienes declarados como excepción por la resolución. Las conferencias registran participantes representados y agenda explícita.
- La interfaz DIPLOMACY permite proponer, aceptar/rechazar, solicitar terminación, votar, proponer embargos y abrir conferencias. Las acciones comparten el sistema de órdenes del anfitrión y los registros públicos se incluyen en snapshot.
- La diplomacia confidencial se rechaza expresamente: el cliente actual distribuye snapshots compartidos y no existe aislamiento por destinatario validado en el servidor. No se filtran datos secretos porque no se admiten.
- Pendiente: contraofertas desde la interfaz, embajadas/diplomáticos, presupuestos y capacidad consular, financiación y órganos de organizaciones, procesos de ratificación constitucional, reclamaciones/reconocimiento, mediación/arbitraje, jurisdicción internacional, relaciones multidimensionales y gestión de sanciones más allá del embargo comercial. Las excepciones de bienes están contempladas en el motor, pero el formulario actual no las permite seleccionar.

### Bloque 21 · Administración pública y burocracia — PARCIAL

- Se conserva y documenta el motor existente bureaucracy.js, en lugar de duplicarlo. Distingue cargos políticos que dirigen de agencias, departamentos y funcionarios civiles que ejecutan y mantienen continuidad institucional tras un cambio de gobierno.
- Las tareas solo nacen cuando una ley y una política están vinculadas explícitamente a un procedimiento. La agencia necesita competencia y jurisdicción correctas; su capacidad depende de personal, oficina, coordinación, corrupción, carga, presupuesto y documentos recibidos. Si no existen recursos, la tarea queda bloqueada o avanza parcialmente: no se da por ejecutada de forma automática.
- Los presupuestos administrativos registran gastos y nóminas, incluidos atrasos. Los proyectos mantienen presupuesto aprobado, gasto, hitos y estados separados. La inspección requiere oficina competente, evidencia escrita y resultado expreso; un rechazo genera rectificación y no finalización ficticia.
- El panel ADMINISTRATION muestra agencias, funcionarios, tareas, proyectos, proveedores y expediente. El registro de proveedores existente no se presenta como contratación pública completa.
- Se corrigió la función submit() ausente en tests/bureaucracy.test.cjs; las 14 pruebas de burocracia pasan.
- Pendiente: ciclo real de licitación y ofertas, puntuación objetiva, adjudicación, contrato, entrega, inspección y pago; formación y trayectoria profesional más completas, descentralización con transferencia efectiva de responsabilidades y administración civil operativa de territorios ocupados, además de censos, licencias, archivos y correo.

### Verificación de los bloques 19–21 · 8 de noviembre de 2026

- node --check correcto en finance.js, diplomacy-advanced.js, game.js, simulation.js, strategy.js, multiplayer.js, scenario.js y bureaucracy.js.
- Suites específicas de finanzas, diplomacia avanzada y burocracia: **27/27 pruebas superadas**. Incluyen conversión FX explícita sin tipo inverso, límites de crédito y liquidez, default y principal moroso, amortización, impuesto parcialmente pagado con atrasos, cesta ponderada, idempotencia diaria, ciclo de simulación, persistencia en snapshot, tratados, bloqueo de guerra, vencimiento de propuestas, voto por Estado, embargo y rechazo de negociación privada.
- Suite completa de 21 archivos: **177 aprobadas / 4 fallidas de 181**. Las cuatro fallas pendientes son: carga de identity.js ausente, dos aserciones preexistentes de media.test.cjs (muestra de encuesta y precisión decimal) y una aserción preexistente de security.test.cjs (warrant expirado/denegado/desajustado). Las dos fallas anteriores de burocracia se han corregido y su suite está en verde.
- Navegador Chrome local: 19 vistas; módulos Finance, Diplomacy y Bureaucracy presentes; todos los IDs de panel/control requeridos presentes; pestañas ECONOMY y DIPLOMACY abren sus vistas; cero excepciones JavaScript. Sin desbordamiento horizontal a 1418 px de escritorio ni a 390 px móvil. identity.js devuelve 404 porque el archivo sigue ausente en el proyecto; no se ha creado una implementación ficticia de identidad durante estos bloques.
- Cambios locales únicamente en docs/Apps/NewWorld; sin commit, push ni despliegue.

## Implementación y verificación de los bloques 22–24 · 8 de noviembre de 2026

**Estado conjunto: PARCIAL.** Los motores, paneles y órdenes ya existían en el repositorio. Esta pasada auditó su integración, corrigió defectos de límites/precisión/expiración y cerró una exposición de registros clasificados en snapshots compartidos. No se declaran completos los bloques.

### Bloque 22 · Medios, prensa y opinión pública

- Archivos: `media.js`, `game.js`, `index.html`, `tests/media.test.cjs`.
- `media.js` valida medios registrados, tipo de propiedad, línea editorial, cobertura provincial, membresía de editores, audiencia/credibilidad/independencia, temas y regla explícita de prensa por Estado. Los nuevos mundos no inventan medios ni valores base.
- Las noticias deben citar eventos existentes del registro compartido del mismo Estado; editorial, análisis y aviso tienen etiquetas propias. La publicación está limitada por la capacidad configurada del medio y del Estado. Los artículos se archivan tras 14 días.
- La opinión se mueve de forma gradual y limitada por alcance, credibilidad, independencia, importancia del tema y libertad de prensa. Se normalizaron las actualizaciones porcentuales a dos decimales para evitar valores como 52.160000000000004.
- Las encuestas usan cantidades de respuestas agregadas, no crean entrevistados sintéticos. La muestra debe ser >=30 y estrictamente menor que la población estimada: una muestra igual al total se considera censo y no una encuesta de opinión. Se conserva el margen de error aproximado.
- Una restricción censoria exige ley vigente que autorice expresamente restricciones de medios, oficina competente, artículo publicado, fundamento escrito y severidad limitada.
- Pendiente: campañas de propaganda, rumores con incertidumbre/rectificación, periodistas NPC, red postal, distribución basada en alfabetización/transporte/coste/idioma, financiación/reputación y difusión internacional completa.

### Bloque 23 · Inteligencia, espionaje y contrainteligencia

- Archivos: `security.js`, `multiplayer.js`, `game.js`, `index.html`, `tests/security.test.cjs`.
- El motor valida agencias, competencias, jurisdicción provincial, ley activa, oficinas de investigación y supervisión separadas, personal/capacidad y autorizaciones. Los incidentes son reportes y no presumen culpabilidad.
- Las investigaciones pueden registrar informes con fuentes del registro local, confianza acotada y clasificación; cierre requiere supervisión independiente y razón escrita. Remisión a justicia debe enlazar un expediente judicial real. Alertas públicas se vinculan a un caso y caducan.
- Si el mandato exige warrant, el investigador lo solicita y una oficina judicial separada decide. La fecha de expiración es exclusiva: un warrant con `expiresOn` igual al día actual ya expiró y no se puede usar.
- **Corrección de privacidad:** `publicSnapshot()` excluye agencias, autorizaciones, incidentes, expedientes, historial, solicitudes y warrants no públicos; conserva solo informes clasificados como públicos y alertas públicas. También filtra las órdenes `security.*` y eventos `security.*` para que sus payloads/motivos no escapen por los registros genéricos. `snapshotForPlayer()` limita registros, órdenes y eventos de seguridad de la vista local del anfitrión a Estados de membresías activas. La interfaz informa que los invitados solo reciben datos de seguridad públicos.
- Límite técnico importante: el relay MQTT existente no ofrece ACL por jugador. Un tópico con ID de jugador no constituye autenticación ni privacidad. Por eso los datos clasificados no se envían a invitados: no se ha implementado todavía un canal privado autenticado/cifrado por destinatario. Esto es una limitación funcional explícita, no una característica terminada.
- Pendiente: agentes y operaciones encubiertas, red de fuentes, contrainteligencia avanzada, secretos compartidos de forma segura, criptografía/códigos, inteligencia militar/económica/tecnológica y consecuencias de filtración integradas con diplomacia/eventos.

### Bloque 24 · Eventos causales e historia emergente

- Archivos: `world-events.js`, `simulation.js`, `multiplayer.js`, `game.js`, `index.html`, `tests/world-events.test.cjs`.
- El anfitrión configura definiciones explícitas por Estado: ventana de fechas, probabilidad por mil, máximo de ocurrencias, cooldown, duración, oficinas decisoras, opciones y efectos permitidos. No se crean eventos automáticamente en un mundo nuevo.
- La tirada es determinista con la identidad de partida, fecha, definición y contador de ocurrencias. El motor registra el evento y lo enlaza al historial global.
- Efectos actuales: delta de tesorería, opinión sobre un tema existente, libertad de prensa y cantidad de un bien configurado. Todos los efectos se validan antes de aplicar el conjunto; el stock, capacidad, ley/objetivo y tesorería deben permitir la operación completa.
- Solo un cargo configurado puede elegir una opción. Las decisiones son órdenes autoritativas; un evento vencido no se resuelve automáticamente por el jugador. Cooldown y máximo de ocurrencias previenen repetición inmediata.
- Pendiente: disparadores causales observados a partir de escasez/deuda/epidemias/tensiones/derrotas/protestas/sucesiones/descubrimientos; crisis agrupadas y escalada; memoria cultural, aniversarios y arqueología; consecuencias completas entre sistemas; diagnóstico visible de por qué se activó o no.

### Pruebas, interfaz y estado global

- Sintaxis Node correcta en `media.js`, `security.js`, `world-events.js`, `multiplayer.js` y `game.js`.
- Pruebas de medios + seguridad + eventos: **31/31 superadas**.
- Pruebas de esos tres bloques junto con multiplayer: **49/49 superadas**. Incluye la prueba añadida de que snapshots públicos no exponen datos clasificados y las vistas por jugador solo incluyen los Estados de membresías activas.
- Suite completa de 22 archivos: **181 aprobadas / 1 fallida de 182**. El único fallo restante es `tests/identity.test.cjs`, que no puede cargar `identity.js`; el archivo está ausente en el proyecto. No se ha creado una implementación ficticia de identidad dentro de estos bloques.
- Chrome local: **19 vistas**, módulos Media/Security/WorldEvents cargados, paneles y IDs requeridos presentes, cero excepciones JavaScript. No hay desbordamiento horizontal a **1440 px** ni a **390 px**. El único HTTP 404 observado es el mismo `identity.js` ausente.
- Actualizados los parámetros de caché de `media.js`, `security.js`, `multiplayer.js` y `game.js` en `index.html`.
- Cambios locales en `docs/Apps/NewWorld` únicamente; sin commit, push ni despliegue.


## Implementación y verificación del bloque 25 · 9 de noviembre de 2026

**Estado: PARCIAL.** Se ha recuperado el módulo ausente `identity.js` que ya estaba referenciado por el HTML, el motor multijugador, el ciclo de simulación y una suite de nueve pruebas. La implementación repara el primer nivel operativo de grupos y perfiles comunitarios; no equivale a completar el sistema exhaustivo de religión, ideologías e identidad descrito en la sección 41 de la especificación.

### Implementado

- `identity.js` inicializa registros vacíos para religiones, instituciones/cargos/comunidades religiosas, ideologías, movimientos, identidades culturales/nacionales, minorías, conversiones y conflictos. Crear una partida no inventa creencias, grupos, organizaciones, afiliaciones ni porcentajes.
- El modelo operativo actual utiliza tres registros configurables: `identityGroups`, `identityProfiles` e `identityOrganizations`. Los grupos admiten categorías separadas (religión, ideología, idioma, cultura, identidad nacional, cívica, histórica y regional), afiliaciones solapadas o exclusivas y estado legal.
- Los perfiles son agregados por provincia y grupo. Validan Estado/provincia real, porcentajes acotados, fecha de actualización y coherencia de referencias. Los grupos exclusivos no pueden sumar más del 100% dentro de la misma provincia y categoría; los no exclusivos pueden solaparse.
- Las organizaciones comunitarias requieren grupo/perfil/provincia coherentes, mandato legal vigente, oficina existente, programas permitidos, coste y capacidad diaria configurados, efectividad y transparencia dentro de límites. No se presume que una organización represente a toda una religión o comunidad.
- La orden `identity.fundCommunityProgram` valida membresía activa, oficina efectivamente ocupada por el jugador, mandato legal aún vigente, programa autorizado, fuerza 1–5, capacidad diaria y tesorería suficiente. La ejecución actualiza únicamente el perfil seleccionado, descuenta el coste real, registra la transacción y añade programa, evento e historial. Los rechazos no gastan dinero ni cambian indicadores.
- `calculateCohesion()` produce estadísticas ponderadas por la cuota poblacional configurada: protección de derechos, acceso a servicios, integración, agravios, confianza institucional, brecha de acceso, cobertura, cohesión y polarización. La propia interfaz advierte que los índices son indicadores agregados del escenario, no medidas científicas universales.
- `advanceDay()` guarda como máximo un snapshot de cohesión por Estado y fecha. La persistencia y el snapshot multijugador ya tenían campos para los registros comunitarios y el historial; el módulo vuelve a proporcionar la lógica que faltaba.
- `index.html` ya tenía el panel IDENTITY, la configuración avanzada y los controles de programas. Se actualizó la versión de caché de `identity.js` a `20261109-identity-v2`; no se reconstruyó el frontend ni se cambió el stack.

### Límites y decisiones pendientes

- La especificación separa Religion, ReligiousInstitution, ReligiousOffice, Ideology, PoliticalMovement, CulturalIdentity, NationalIdentity, MinorityStatus, ConversionRecord e IdentityConflict. En esta fase se han preparado registros vacíos, pero no se han implementado sus flujos de creación, gobierno, nombramiento, sucesión, financiación, cisma, difusión, derechos ni resolución.
- El modelo actual de perfiles no representa aún todas las distribuciones de PopulationGroup ni las afiliaciones multidimensionales por grupo social. Tampoco conecta preferencias ideológicas con partidos, programas, movimientos y opinión pública.
- La relación constitucional Estado-religión no dispone aún de permisos/restricciones ejecutables para culto, propiedad, educación, asistencia, financiación pública, cargos o jurisdicción. No se ha concedido autoridad jurídica a ninguna institución religiosa.
- Las conversiones y la difusión no se ejecutan automáticamente. Las tasas, factores, límites y exposiciones siguen pendientes de definición; no se ha añadido ninguna conversión ficticia.
- No se generan conflictos por diferencias religiosas o ideológicas. La discriminación, protesta, persecución, violencia, mediación y desplazamiento necesitan causas y reglas explícitas, integración con seguridad/justicia/migración y contabilidad de víctimas/desplazados.
- Los efectos por fuerza de los seis programas comunitarios actuales son una base técnica provisional reflejada en el código y en las pruebas; no deben tratarse como balance definitivo ni como una decisión de diseño aprobada. Requieren revisión antes de fijar el equilibrio del juego.
- La fórmula actual de cohesión/polarización también es provisional. En concreto, el término de brecha de acceso suma al índice de cohesión; esa relación puede ser contraintuitiva y debe revisarse antes de usar el indicador para decisiones de IA o balance. Además, perfiles no exclusivos pueden representar poblaciones solapadas: su suma no equivale a un recuento de habitantes únicos.
- El panel actual presenta grupos/perfiles/organizaciones comunitarias y financiación de programas. No hay aún vistas operativas independientes para jerarquías religiosas, movimientos ideológicos, identidades nacionales, derechos de minorías, conversiones o conflictos.
- Los registros compartidos actuales son agregados y no almacenan creencias individuales de jugadores humanos. Aún falta un sistema de permisos de lectura diferenciado para datos internos de instituciones.

### Archivos afectados

- `identity.js` — nuevo motor de validación, indicadores, programas comunitarios e historial diario.
- `index.html` — actualización del parámetro de caché de `identity.js`.
- `IMPLEMENTATION-STATUS.md` — estado, límites y verificación del bloque 25.

### Verificación ejecutada

- `node --check`: **20/20 archivos JavaScript** correctos.
- `node --test tests/identity.test.cjs`: **9/9 pruebas superadas**.
- Suite completa `node --test tests/*.test.cjs`: **190/190 pruebas superadas**, 0 fallos.
- La suite comprueba registros iniciales vacíos, referencias geográficas y legales, porcentajes y exclusividad, cálculo agregado, permisos de oficina, gasto de tesorería, capacidad diaria, rechazo atómico y snapshots diarios idempotentes.
- Pendiente en esta pasada: prueba visual de navegador/errores de consola y verificación manual de flujo de escenario desde la interfaz.
- Cambios locales únicamente en `docs/Apps/NewWorld`; no se ha hecho commit, push ni despliegue.

## Actualización técnica — 9 de noviembre de 2026

### Bloque 11 — Reloj y simulación (COMPLETADO)

- `simulation.js` incorpora `nextGregorianDate()`: valida `YYYY-MM-DD`, rechaza fechas imposibles y aplica el calendario gregoriano desde 1500. Los avances inválidos son atómicos. Se prueban límites mensuales/anuales y años seculares 1500, 1600, 1900, 2000 y 2100.
- El host conserva el reloj autoritativo: estado, versión, fecha, referencia temporal y acumulador. Un día equivale exactamente a 300 segundos reales a 1x; no existen velocidades adicionales. Los ciclos retrasados se procesan en lotes máximos de 24, conservando el resto pendiente sin descartar días.
- PauseVote es individual por jugador y partida. El umbral operativo es mayoría estricta de conectados (`votos > conectados / 2`): un empate no cambia el estado, las abstenciones no suman votos y una modificación del roster conectado reinicia la votación. El host no dispone de una pausa política unilateral.
- La desconexión del último jugador pausa el mundo y deja el motivo `NoConnectedPlayers`. La pérdida del relay del host con otros jugadores aún conectados se registra de forma diferenciada (`HostRelayLost`). La reconexión no reanuda automáticamente una partida pausada.
- El mantenimiento técnico es un estado operativo separado de `running/paused`, con razón pública, mensaje versionado, validación de mundo/revisión y aviso a clientes conectados. Detiene el reloj sin cambiar el estado político; al terminar, reinicia la referencia temporal.
- El transporte del reloj utiliza MQTT sobre WebSocket seguro (WSS). Los invitados reciben snapshots/deltas y solo interpolan la presentación; nunca adelantan su propio calendario.
- Dos slots alternos de guardado, validación de integridad y recuperación verificable conservan el acumulador intradía. La restauración reinicia la referencia en el nuevo host y no suma tiempo offline.
- No hay pendientes dentro del alcance confirmado del bloque. La autoridad temporal pertenece al host de la partida, según la arquitectura activa; no existe un servidor central persistente y no se afirma que lo haya.

### Bloque 24 — Eventos causales (sigue PARCIAL)

- `world-events.js` admite condiciones declarativas con comparación `gt/gte/lt/lte/eq` y grupos `all/any`. Las condiciones solo admiten métricas de una lista cerrada, con umbral numérico explícito.
- Primeras métricas conectadas al estado observado del mismo Estado y fecha: demanda de mercado no satisfecha, déficit de agua, defaults de deuda pública, derrotas militares y alertas públicas de seguridad.
- Cada ocurrencia conserva valores observados, operadores, umbrales, coincidencias y tirada determinista. `explainEvaluation()` devuelve por qué una definición no está elegible en la fecha actual.
- El panel EVENTS presenta diagnósticos por definición y evidencia de disparo en eventos activos e históricos. Se actualizó la caché de `world-events.js` y `game.js`.
- Los informes privados de incidentes de seguridad no se leen ni se convierten en una métrica pública: el primer indicador de seguridad usa exclusivamente alertas expresamente públicas. Así se evita crear un canal lateral que filtre registros de inteligencia.
- No se marca completo: faltan causas de epidemias, tensiones, protestas, sucesiones y descubrimientos, además de crisis agrupadas/escaladas, memoria histórica y efectos multi-sistema más amplios. Los mundos nuevos siguen sin eventos ficticios.

### Verificación de esta actualización

- `node --check`: **20/20 archivos JavaScript**.
- `node --test tests/world-events.test.cjs`: **11/11 pruebas superadas**.
- `node --test tests/*.test.cjs`: **205/205 pruebas superadas**, 0 fallos.
- `node --test tests/multiplayer-load.test.cjs`: **12/12 pruebas superadas**; incluye reanudación sin tiempo offline, mantenimiento técnico, desconexión/reconexión del host, restauración a mitad de ciclo y fecha idéntica en clientes.
- `node --test tests/multiplayer.test.cjs`: **21/21 pruebas superadas**; incluye validación/versionado del mensaje de mantenimiento, comunicación host-invitado y pausa por pérdida del relay.
- `node --check`: **20/20 archivos JavaScript**.
- Se añadieron pruebas de eventos causales y reloj; la suite completa volvió a ejecutarse después de los cambios y no presenta fallos.
- Cambios locales únicamente. No se ha hecho commit, push ni despliegue.

### Bloque 10 — Interfaz principal: actualización de órdenes y alertas

- Nuevo módulo command-inbox.js separa la clasificación de avisos de la capa visual. Las alertas registran ID estable, categoría, prioridad, origen, fecha del mundo, texto, estado de lectura, número de ocurrencias y acción de navegación.
- Los sucesos repetidos se agrupan por tipo, Estado y fecha sin perder los IDs originales; un grupo sigue sin leer mientras conserve al menos un suceso no leído.
- La bandeja añade órdenes locales y ya enviadas, distingue su estado de entrega, guarda las lecturas por jugador y partida y ofrece acceso al sistema pertinente y al Estado relacionado.
- Se añadieron rutas explícitas para los 19 subsistemas activos; la navegación queda verificada en correspondencia 19 vistas / 19 pestañas, con destino ARIA válido.
- Cada panel principal recibe estado común loading, empty, ready, stale, error o no-permission. La desconexión no hace pasar la última información recibida por información actualizada.
- La bandeja tiene región etiquetada, resumen y lista aria-live, teclado Escape, retorno del foco, etiqueta legible de prioridad/lectura, acciones, estilos responsive y soporte prefers-reduced-motion.
- Pruebas nuevas: command-inbox.test.cjs (8) e interface-contract.test.cjs (6). Verifican agrupación, persistencia de lectura, prioridad, clasificación, rutas, órdenes pendientes, límites de contenido, correspondencia de vistas y contratos de accesibilidad/panel.
- Sigue PARCIAL: el botón abre la vista y selecciona el Estado, pero aún no enfoca el registro concreto dentro de esa vista. El estado no-permission existe como contrato común y estilo, pero falta aplicarlo consistentemente a cada acción restringida. No se ha podido realizar una auditoría visual automatizada de navegador ni probar lectores de pantalla reales.

### Verificación consolidada — 9 de noviembre de 2026

- node --check: 21/21 archivos JavaScript.
- node --test tests/*.test.cjs: 219/219 pruebas superadas, 0 fallos.
- Los resultados incluyen mantenimiento técnico en host e invitado, suspensión/reanudación, reloj compartido, recuperación de acumulador, causas de pausa por pérdida de relay y los nuevos contratos de bandeja e interfaz.
- Cambios locales únicamente en docs/Apps/NewWorld; no se ha hecho commit, push ni despliegue.

### Bloque 14 — Salud pública y epidemiología: ampliación funcional

- Nuevo epidemiology.js conectado al ciclo de simulación autoritativo, posterior a la evolución demográfica. El día de aparición se registra sin consumir inmediatamente un día de exposición; la evolución posterior avanza con el calendario del host.
- El escenario puede declarar definiciones de enfermedad y fechas/semillas de brote. Cada definición declara Estado, incubación, duración infecciosa, transmisión, mortalidad y enlaces direccionales entre grupos de población del mismo Estado con contactos diarios explícitos.
- La simulación mantiene compartimentos agregados susceptibles, expuestos, infecciosos y recuperados por grupo. Los contagios respetan contactos y parámetros configurados; las cantidades fraccionarias conservan restos; la exposición está limitada a la población susceptible real.
- Las muertes epidemiológicas se distribuyen entre cohortes de edad, reducen la población real del grupo y del Estado y actualizan contadores demográficos. El ciclo services.js calcula healthMortalityReductionPercent por grupo con el acceso y la calidad efectivos del servicio. La prueba integrada confirma que esa reducción se aplica tanto a mortalidad demográfica como a epidemias; no hay efecto sanitario donde no existe cobertura configurada.
- Una configuración incoherente de cohortes o de contactos aborta el ciclo sin aplicar cambios parciales. Los brotes terminan cuando no quedan residentes expuestos ni infecciosos.
- La configuración se valida en el setup del anfitrión, se guarda en el snapshot y se replica a los clientes. La huella inicial del escenario incluye perfiles demográficos, estructura estable de grupos, reglas de enfermedad y semillas fechadas; no incluye la evolución diaria de compartimentos ni la población viva, que cambiaría durante la partida.
- El panel SOCIETY muestra brotes activos/completados y programados, expuestos, infecciosos, recuperados, muertes y exposiciones. Los mundos nuevos no reciben enfermedades, brotes ni parámetros inventados.
- Bloque 14 sigue PARCIAL: faltan migración exterior coordinada, urbanización, esperanza de vida, mortalidad por causas generales y factores completos de empleo/vivienda/seguridad/familia/persecución; no se derivan contactos de la movilidad real; faltan familias NPC relevantes, prevención/tratamiento, cuarentena y medidas públicas. La cobertura y calidad sanitaria ya se conectan automáticamente con la reducción de mortalidad ordinaria y epidémica; una prueba integrada valida ambos efectos.

### Bloque 24 — Nuevas causas de salud pública

- El catálogo de condiciones admite cinco métricas epidemiológicas agregadas: exposiciones, nuevas infecciones, muertes epidemiológicas, casos activos y brotes activos.
- Los valores observados se calculan para el mismo Estado y fecha. Las exposiciones/infecciones/muertes utilizan eventos epidemiológicos públicos; los casos y brotes activos usan compartimentos agregados y registros de brote. No se consultan expedientes privados de inteligencia.
- Se añadieron pruebas de validación de métricas, separación de Estado/fecha y disparo con evidencia exacta. El bloque permanece PARCIAL por las causas no implementadas de tensiones, protestas, sucesiones, descubrimientos, memoria cultural y escalada de crisis.

### Verificación consolidada — 9 de noviembre de 2026

- `node --check`: **22/22 archivos JavaScript**.
- `node --test tests/*.test.cjs`: **234/234 pruebas superadas**, 0 fallos.
- `epidemiology.test.cjs`: 8/8; `interface-contract.test.cjs`: 8/8; `scenario.test.cjs`: 9/9; `world-events.test.cjs`: 13/13. Las pruebas de integración de ciclo, snapshots y multiplayer también pasan en la suite completa.
- `git diff --check -- docs/Apps/NewWorld` informa una línea con espacio final en `tests/multiplayer-load.test.cjs:329`. Es un espacio preexistente señalado en la auditoría anterior de ese archivo y no se ha eliminado para evitar tocar esa modificación ajena a esta fase. Git también muestra avisos de normalización LF/CRLF; no son fallos de pruebas.
- Cambios locales únicamente. No se ha hecho commit, push ni despliegue.


## Bloque 10 — Deep-link de alertas de la bandeja — 9 de noviembre de 2026

**Estado: PARCIAL.** Se ha cerrado una carencia concreta de navegación: las alertas ya no se limitan a abrir la vista general; intentan llevar el foco al registro exacto cuando el panel de destino expone un identificador estable.

### Cambio aplicado

- Al abrir una alerta, el cliente conserva la selección del Estado y activa la vista correspondiente.
- La nueva función `focusInboxReference(viewName, referenceId)` busca dentro de esa vista coincidencias exactas en `data-record-id`, `data-id` o `id`. Si encuentra el registro, lo desplaza al centro y le da foco accesible.
- Si el panel no expone un identificador coincidente, el comportamiento es explícito y seguro: enfoca el encabezado del panel; si no existe, enfoca la propia vista. No inventa un destino ni selecciona un registro parecido.
- Se actualizó el parámetro de caché de `game.js` para evitar que el navegador reutilice la versión anterior.
- Se amplió `tests/interface-contract.test.cjs` para comprobar que la navegación pasa la referencia de la alerta y que el resolvedor admite los tres identificadores exactos.

### Archivos afectados

- `game.js` — navegación y foco del registro de destino.
- `index.html` — versión de caché de `game.js`.
- `tests/interface-contract.test.cjs` — contrato de navegación actualizado.
- `IMPLEMENTATION-STATUS.md` — este registro.

### Verificación y límites

- `node --check game.js`: correcto.
- `node --test tests/interface-contract.test.cjs`: **8/8 pruebas superadas**.
- `node --test tests/*.test.cjs`: suite completa ejecutada sin fallos visibles en la salida de pruebas; la verificación final de recuento se conserva pendiente de una ejecución que capture el resumen de Node.
- No se ha demostrado todavía que cada uno de los 19 paneles publique el atributo de ID correcto para todos sus registros. En esos casos la función usa el fallback accesible al encabezado.
- Sigue pendiente aplicar el estado `no-permission` de forma uniforme a todas las acciones, auditoría visual real con navegador/zoom/lectores de pantalla y pruebas manuales completas por rol. Por tanto, el bloque 10 permanece PARCIAL.
- Cambios locales únicamente en `docs/Apps/NewWorld`; sin commit, push ni despliegue.


## Actualización funcional — bloques 12, 20 y 21 — 11 de noviembre de 2026

### Bloque 12 · Copias portátiles cifradas de la partida

- Se añadió `portable-backup.js` con cifrado autenticado AES-256-GCM. La contraseña deriva la clave mediante PBKDF2-SHA-256 con 310.000 iteraciones; cada exportación usa salt de 16 bytes y nonce de 12 bytes aleatorios. Formato, versión, parámetros y datos asociados se validan antes de descifrar.
- La contraseña no se almacena. Se exige un mínimo de 12 caracteres. El módulo rechaza formatos, parámetros, Base64 y tamaños inválidos, así como archivos manipulados o contraseñas incorrectas. El límite de datos serializados es 50 MB.
- `multiplayer.js` expone exportación solo al anfitrión activo y solo tras una escritura local verificada. La importación requiere que no haya runtime conectado; valida la envoltura, sala, ID de partida, identidad del anfitrión y token, instala la partida en la ranura alterna y vuelve a comprobarla leyendo desde el almacenamiento.
- La importación restaura la ranura anterior si falla una escritura o su verificación. La interfaz descarga archivos `.nwbackup` cifrados, pide la contraseña dos veces al exportar y exige confirmar que el anfitrión original está completamente cerrado antes de restaurar, para evitar dos autoridades ejecutando la misma partida.
- La copia incluye el token del anfitrión y credenciales de los jugadores. El archivo y la contraseña deben mantenerse privados; perder la contraseña impide recuperar el contenido. No se ha creado sincronización en nube ni elección automática de anfitrión.

### Bloque 20 · Contraofertas diplomáticas desde la interfaz

- Las propuestas pendientes dirigidas al Estado seleccionado incorporan un panel desplegable de contraoferta.
- El jugador puede conservar/modificar cláusulas compatibles con el motor (no agresión, paz, defensa mutua, cooperación comercial, tránsito y reconocimiento), indicar duración y adjuntar una nota no vinculante.
- El cliente valida que exista al menos una cláusula y una duración entre 1 y 36.500 días. La orden se vuelve a validar en el host; la nota no altera cláusulas ni crea por sí sola un tratado.
- La notificación aclara que el aviso de terminación conserva el plazo original. La contraoferta reemplaza la propuesta pendiente y no activa automáticamente un tratado.

### Bloque 21 · Ciclo operativo de contratación pública

- Se añadió un ciclo explícito a `bureaucracy.js`: abrir licitación, registrar ofertas recibidas, cerrar el periodo, adjudicar, registrar entrega, inspeccionar, pagar o cancelar con motivo.
- La publicación exige agencia existente, competencia declarada, provincia dentro de jurisdicción, presupuesto válido, titularidad del cargo supervisor y un cargo inspector distinto de la cadena supervisora. El inspector no puede ser el mismo jugador que publica o adjudica.
- Antes de publicar se reserva el importe estimado, respetando la reserva mínima de la agencia y otros compromisos. Nóminas y procedimientos diarios solo pueden consumir fondos libres y no gastan dinero comprometido.
- Solo se admiten proveedores existentes, activos y con la competencia necesaria. El sistema registra un precio en unidades monetarias de dos decimales, plazo y referencia documental; cada proveedor puede presentar una oferta por licitación.
- Tras la fecha de cierre, las ofertas válidas quedan cerradas. La adjudicación aplica una regla determinista: menor precio entre las ofertas válidas de proveedores activos y competentes; el empate se resuelve por ID estable del proveedor. La reserva se reduce al importe adjudicado y el excedente se libera.
- La recepción de entrega requiere evidencia escrita. La inspección corresponde al cargo independiente indicado al publicar; exige resultado explícito y evidencia, y separa aceptación de rectificación. El pago solo se autoriza tras aceptación; se registra importe, moneda, presupuesto, proveedor, fecha y actor.
- La cancelación previa a la adjudicación necesita motivo y libera la reserva. Una licitación que cierra sin oferta activa y competente se cancela automáticamente, también liberando el importe comprometido.
- La interfaz del panel ADMINISTRATION incluye formulario de publicación, selección de agencia/provincia/competencia/inspector, importe y plazo; después muestra ofertas, adjudicación, entregas, inspecciones y pago. Las acciones aparecen según el cargo y la fase.
- Alcance no cubierto: portal externo de licitación, recepción de documentos firmados digitalmente, evaluación multicriterio, contratación por lotes, recursos/reclamaciones de proveedores, legislación de contratación completa, fiscalidad del contrato y detección avanzada de conflictos entre proveedores. Las ofertas se registran dentro de la partida como ofertas recibidas, no se envían a empresas por internet.

### Validación consolidada de esta fase

- `node --test tests/*.test.cjs`: **247/247 pruebas superadas**, 0 fallos, 0 omitidas.
- `node --check`: **23/23 archivos JavaScript** sin errores de sintaxis.
- Pruebas específicas de burocracia: **17/17**; incluyen adjudicación, protección de reservas frente a nóminas, inspección independiente, rechazo/rectificación, pago posterior a aceptación y cancelación sin ofertas.
- Pruebas específicas de cifrado y contratos visuales: validan AES-GCM, salt/nonce aleatorios, parámetros PBKDF2, contraseñas incorrectas, manipulación del ciphertext, formatos inválidos, límites de tamaño y acceso solo del anfitrión.
- `git diff --check` mantiene un fallo preexistente por espacio final en `tests/multiplayer-load.test.cjs:329`; no se modificó esa línea. También aparecen avisos normales de conversión LF/CRLF.
- No se realizó prueba visual manual completa en navegador, prueba real en dos equipos ni recuperación con pérdida del perfil original. Los controles y órdenes se validaron mediante pruebas de contrato y el motor con tests Node.
- Cambios locales únicamente. No se hizo commit, push ni despliegue. Se conservaron los cambios anteriores del repositorio.
