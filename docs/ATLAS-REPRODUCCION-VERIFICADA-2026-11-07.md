# ATLAS — EN VIVO y REPRODUCCIÓN HISTÓRICA ×12

Fecha: 7 de noviembre de 2026. Alcance: vuelos civiles, sin cambiar las fuentes ni las coordenadas recibidas.

## Experiencia
- **EN VIVO** (predeterminado): posiciones de OpenSky recibidas y, cuando hay dos fixes, interpolación entre ellos. Si no hay nuevo fix, se espera; no se predice hacia adelante.
- **HISTORIAL ×12** (opción explícita en «Vuelos en vivo»): reproduce un intervalo UTC común de posiciones registradas, 12 veces más rápido. La posición representada es HISTÓRICA, no actual; interpolar dos fixes no es una medición intermedia exacta.
- Aviones sin dos fixes que cubran ese instante no aparecen en la reproducción. Disponible solo con suficientes fixes recientes.
- Al llegar al final regresa a EN VIVO automáticamente. También hay botón manual.
- No cambia TomTom, tráfico vial ni servidor.

## QA
1. Ejecutar `node --test src/layers/flights/observedReplay.test.mjs src/layers/flights/motion.test.mjs`.
2. Ejecutar `npm run format:check && npm test && npm run build`.
3. Probar México y Estados Unidos, lejos/cerca, avión seleccionado y no seleccionado, aviso histórico y retorno a EN VIVO.
4. Confirmar CI y deploy del mismo SHA. «Coolify Success» no prueba animación en navegador.

## Precisión
No se crean vuelos ni coordenadas GPS. El modo histórico interpola entre reportes reales ya recibidos y se identifica expresamente. En EN VIVO el movimiento puede ser subpíxel a escala continental.
