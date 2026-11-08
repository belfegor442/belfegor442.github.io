# New World — informe de estado

**Fecha de evaluación:** 8 de noviembre de 2026
**Versión evaluada:** estado del repositorio después de integrar el constructor estilo TheoTown
**Clasificación:** **ALPHA — BASE JUGABLE, SISTEMAS ESTRATÉGICOS INCOMPLETOS**
**Completitud global estimada:** **4,0/10**

## 1. Evaluación general

New World ya tiene una base técnica y jugable: mapa extenso, terreno generado de forma determinista, construcción sobre parcelas, expansión territorial, economía diaria y multijugador por salas. No es correcto describirlo como un simple prototipo visual.

Tampoco es un juego terminado. Varias secciones importantes —gobierno, ejército e investigación— tienen modelos de datos y pantallas de consulta, pero sus acciones principales todavía no están conectadas a reglas autoritativas completas. La experiencia actual se parece más a una **alpha estratégica con sistemas parciales** que a un juego de conquista acabado.

La nota mide la profundidad funcional del juego, no la calidad del código ni el aspecto visual.

## 2. Clasificación por sistemas

| Sistema | Nota | Estado | Motivo |
|---|---:|---|---|
| Mapa y terreno | **7/10** | Avanzado, aún parcial | Mundo de 1024 × 1024 parcelas, terreno determinista y capas físicas diferenciadas. |
| Constructor estilo TheoTown | **8/10** | Funcional | Catálogo visual de 145 opciones, categorías, búsqueda, vista previa, rotación y colocación sobre el mapa. |
| Expansión territorial | **5/10** | Básico funcional | Se pueden reclamar territorios disponibles, pagar su coste de administración y transferir fondos de asentamiento. |
| Economía | **5/10** | Parcial funcional | Hay producción diaria, inventarios, mercados, variación de precios, necesidades de población y lógica para rutas comerciales. |
| Población y servicios | **4/10** | Parcial | La capacidad de vivienda, comida, agua, empleo y servicios afecta al crecimiento; falta una simulación social más profunda. |
| Multijugador | **5/10** | Experimental | Hay salas, anfitrión, invitados, sincronización y reconexión. La autoridad del mundo sigue dependiendo del navegador del anfitrión. |
| Gobierno | **2/10** | Principalmente estructural | Existen pantallas y datos de constituciones, cargos y decisiones, pero las acciones políticas no están conectadas a un conjunto completo de órdenes ejecutables. |
| Ejército y guerra | **1/10** | Incompleto | Se pueden representar unidades, comandantes, rutas, órdenes, batallas y ocupaciones; el movimiento militar mostrado por la interfaz aún no está admitido por el procesador de órdenes. |
| Investigación | **2/10** | Incompleto | Hay catálogo tecnológico, instituciones y proyectos representables, pero iniciar, cancelar y adoptar investigaciones no dispone todavía de una ejecución completa en el motor de órdenes. |
| Objetivos y progresión | **1/10** | Insuficiente | No hay una campaña completa con objetivos, condiciones de victoria, derrota y progresión final claramente conectadas. |

## 3. Qué funciona realmente

### Mundo y construcción

- El mapa admite 1.048.576 parcelas de terreno.
- La generación del terreno es determinista para un territorio.
- El terreno diferencia costa, ríos, llanuras, bosques, colinas, montañas y humedales.
- El constructor contiene 145 opciones visuales repartidas en 9 categorías.
- Se puede seleccionar un elemento, inspeccionar sus datos, girarlo y colocarlo en una parcela válida.
- La construcción se valida en el anfitrión y descuenta el coste correspondiente.

**Limitación importante:** las 145 opciones son variantes visuales del catálogo, no 145 edificios con comportamientos económicos únicos. El motor actual agrupa sus efectos en 8 familias: granja, mercado, taller, vivienda, instalaciones de agua, clínica, escuela y carretera.

### Economía y población

- El escenario inicial puede crear empresas, recetas de producción, mercados y grupos de población.
- El avance de un día procesa producción, demanda y liquidación de mercados.
- Los productos tienen inventario y las operaciones registran movimientos económicos.
- Los precios pueden cambiar según oferta y demanda.
- La falta de existencias puede dejar demanda sin cubrir.
- La construcción terminada modifica capacidades del asentamiento y puede afectar al crecimiento de población.
- El motor contempla rutas comerciales, aunque el escenario inicial no crea rutas activas por defecto.

### Territorios y multijugador

- Un jugador puede reclamar una región disponible mediante una orden validada por el anfitrión.
- La expansión tiene coste y puede transferir una subvención al nuevo asentamiento.
- Los miembros del gobierno fundador pueden incorporarse a la región reclamada.
- Las pruebas automatizadas incluyen una sala simulada con 67 clientes y la comprobación del inicio del mundo.

**Limitación importante:** esa prueba de 67 clientes usa un relay en memoria. No demuestra que 67 personas conectadas desde Internet puedan jugar durante una sesión real sin problemas. Además, el anfitrión ejecuta el reloj y la simulación; si pierde la conexión, el mundo se pausa.

## 4. Bloqueos que impiden considerarlo un juego completo

1. **Guerra no operativa:** la interfaz muestra unidades y permite solicitar movimientos, pero el procesador de órdenes todavía rechaza los tipos de orden militares no implementados. No existe un ciclo completo y probado de movimiento, combate, bajas, ocupación y transferencia territorial.
2. **Gobierno incompleto:** hay estructuras para cargos, constituciones y decisiones, pero las decisiones políticas necesitan validación, votación, ejecución y consecuencias persistentes en el servidor.
3. **Investigación incompleta:** faltan las reglas ejecutables que consuman presupuesto y materiales, hagan avanzar proyectos y apliquen efectos de tecnologías.
4. **Dependencia del anfitrión:** el navegador que crea la partida es también la autoridad de la simulación. No hay un servidor dedicado independiente que mantenga el mundo por sí mismo.
5. **Poca profundidad de victoria y progresión:** falta un objetivo de largo plazo que conecte expansión, economía, política, ejército e investigación.
6. **Variedad mecánica limitada:** el catálogo de construcción es amplio visualmente, pero el número de familias con efectos propios sigue siendo reducido.

## 5. Prioridades de desarrollo

| Prioridad | Trabajo | Criterio para darlo por terminado |
|---:|---|---|
| **P0** | Completar órdenes militares | Movimiento validado, suministro, combate, bajas, ocupación y consecuencias territoriales cubiertos por pruebas. |
| **P0** | Completar gobierno | Propuestas, votos, permisos, aprobación y aplicación de decisiones con estado persistente. |
| **P0** | Completar investigación | Proyectos que consuman recursos, progresen por días, desbloqueen tecnologías y apliquen efectos reales. |
| **P1** | Independizar la simulación del anfitrión | El mundo debe seguir funcionando aunque el navegador del creador se cierre o desconecte. |
| **P1** | Profundizar la simulación económica y social | Más bienes, cadenas de producción, empleo, necesidades y consecuencias de escasez. |
| **P1** | Dar objetivos al mundo | Condiciones de victoria y derrota, hitos de progreso y objetivos configurables por partida. |
| **P2** | Ampliar la variedad de construcción | Más familias con efectos diferenciados, mejoras y dependencias entre edificios. |

## 6. Verificación técnica

En la ejecución de pruebas disponible para esta evaluación:

- **38 pruebas automatizadas superadas.**
- **0 pruebas fallidas.**
- Se cubren catálogo de construcción, terreno y mapa, órdenes de expansión y construcción, economía diaria y una simulación multijugador de 67 clientes.
- La prueba de carga multijugador es una simulación de relay en memoria, no una prueba de estrés de Internet.
- Que las pruebas pasen demuestra que los comportamientos cubiertos funcionan bajo esas condiciones; no certifica los sistemas que aún no tienen implementación o pruebas.

## 7. Veredicto

**New World está en ALPHA. Completitud estimada: 4,0/10.**

Su punto más sólido es la base de mundo, mapa y construcción. Ya tiene suficientes sistemas para empezar partidas y desarrollar asentamientos, pero todavía no ofrece un ciclo estratégico completo: la conquista militar, la política, la investigación y la progresión necesitan implementación real.

**No debe clasificarse como beta ni como juego terminado.** La siguiente etapa no debería consistir en añadir más pantallas: debería convertir los sistemas de guerra, gobierno e investigación en mecánicas que los jugadores puedan ejecutar, alterar y comprobar dentro de una partida.
