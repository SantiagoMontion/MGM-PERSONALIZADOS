# EditorCanvas

Componente de editor basado en **react-konva** con zoom, arrastre y exportación en alta resolución.

## Instalación

```bash
npm install react-konva konva
```

## Uso

```jsx
import EditorCanvas from './src/components/EditorCanvas';

<EditorCanvas
  imageUrl={url}
  sizeCm={{ w: 90, h: 40 }}
  bleedMm={3}
  ref={canvasRef}
/>
```

### Exportación

```js
const blob = await canvasRef.current.exportArtboard({ scale: 2 });
```

- `scale`: multiplicador (1 = 300 DPI aprox.).
- `mime`: `image/png` o `image/jpeg`.
- `quality`: 0–1 (solo JPEG).

## Teclas rápidas

- `Ctrl+0`: ajustar vista.
- `Ctrl+1`: zoom 100%.

