# ATLAS · Auditoría de movimiento de vuelos (2026-11-07)

## Alcance y checkpoint

Producción observada: rama \`feature/mexico-transit\`, commit \`8c9d3d4\`. Las capturas suministradas muestran aproximadamente 526–527 vuelos en Estados Unidos; **no demuestran que todos estén actualizando posiciones**. Ningún dato de avión ni render frame ha sido medido desde una sesión instrumentada de ATLAS.

Esta auditoría se prepara fuera de producción en \`audit/atlas-motion-veracity-20261107\`. No implica modificar el servicio de Coolify.

## Hallazgos comprobados en el código

1. \`lifecycle.enable()\` llama a \`holdContinuousRender('flights')\` e instala \`scene.preRender -> _fleetTick\`; la flota **tiene un render loop** previsto cada \`FLEET_DR_INTERVAL_MS\`. La cámara inmóvil por sí sola no debería apagarlo mientras la capa esté habilitada.
2. En \`motion._deadReckon()\`, el modo \`_verifiedPositionsOnly\` reproduce entre los **dos últimos fixes observados** durante un intervalo calculado por \`receivedMs\`. Una vez alcanza el segundo fix, **se detiene hasta que haya un nuevo fix**. Eso evita extrapolar, pero crea periodos perceptibles de inmovilidad, incluso a escala cercana si las posiciones llegan espaciadas.
3. A zoom continental/global, un desplazamiento físicamente correcto puede equivaler a una fracción de píxel. El tamaño fijo del símbolo no implica que su posición cambie a escala perceptible.
4. \`snapshotRenderer\` solo añade historial cuando avanza \`positionTimeMs\`; 40 fixes es un máximo de almacenamiento, **no garantiza 40 observaciones distintas**.
5. \`scopeFlightSnapshot\` reduce contactos visibles por presupuesto/región. El número total de vuelos que muestra la interfaz no certifica por sí solo disponibilidad mundial, frecuencia por contacto o actualización.
6. Existe una prueba anterior que seguía exigiendo el antiguo \`renderTime\` verificado; no cubría la implementación actual basada en \`receivedMs\`. Esta rama sustituye ese caso por pruebas temporales deterministas.
7. Los resultados de GitHub Actions consultados no muestran una corrida CI asociada al commit de producción \`8c9d3d4\`. \`Coolify Success\` prueba arranque/despliegue, no movimiento correcto. No declarar QA verde sin job del mismo SHA.

## Solución de producto en dos representaciones honestas

**EN VIVO / POSICIÓN VERIFICADA**: la silueta permanece sobre la posición real observada o interpolada entre dos observaciones, con fecha/antigüedad y procedencia. Nunca aumentar distancias recorridas solo para animar iconos.

**REPRODUCCIÓN REAL (optativa y claramente rotulada)**: reproducir a 4×–12× el historial observado acumulado, con reloj de reproducción distinto del reloj actual. Así los aviones recorren en pantalla rutas que **sí ocurrieron** y se pueden ver a gran escala, sin presentarlas como posiciones de ahora. Al salir de Replay, volver a último fix verificado. Si no hay historial, indicar «Aún sin historial», no simularlo.

## Una sola ronda de implementación futura (sin micro-deploys)

- Añadir telemetría visible o diagnósticos de: contactos frescos, contacto con un fix, interpolando, sosteniendo último fix, última recepción y fuente/cobertura.
- Calcular visibilidad en píxeles desde cámara y distinguir «se está actualizando» de «se desplaza perceptiblemente». No usar velocidad escalada en EN VIVO.
- Implementar Replay histórico explícito con historial REAL, reloj visible y control para regresar a EN VIVO. No solicitar 500 tracks históricos individuales a una API pública sin evaluar cuotas.
- Validar con fixtures que contienen fixes nuevos, repetidos, atrasados, ausentes, cambio de zona, seleccionado/no seleccionado y cámara a 300 m / 10 km / 1,000 km / 4,000 km.
- Compilar, ejecutar CI completa en el SHA exacto, ensayar visualmente al menos México y EE. UU. y desplegar **un solo paquete** en Coolify. Registrar versión y checkpoint.

## Criterios de aceptación

- **Nunca** representar datos simulados como posiciones verificadas.
- EN VIVO y Replay usan relojes y rótulos inequívocos.
- Un contacto con un solo fix no se interpola ni extrapola.
- Con dos fixes observados, la interpolación permanece dentro de esos extremos; al terminar no sale del último fix.
- Visualización continental informa movimiento verificado aunque la traslación física sea subpíxel; Replay es la opción para ver recorrido acelerado de hechos pasados.
- Contactos omitidos/agotados muestran estado de frescura; una cobertura regional jamás se etiqueta como mundial.
- CI del SHA de entrega y despliegue Coolify deben estar confirmados antes de anunciar «Listo, revisa».

## Estado de esta entrega

Diagnóstico y pruebas corregidas preparadas en rama de auditoría. **Sin despliegue a producción ni validación visual declarada.**
