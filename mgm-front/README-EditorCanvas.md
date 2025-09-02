# EditorCanvas

Editor 2D para personalización de mousepads construido con **react-konva**. Soporta zoom con rueda, arrastre, transformación de imagen, modos de ajuste y exportación en alta resolución.

## Dependencias

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

## Barra de herramientas

- **Alineación:** Centro, Izquierda, Derecha, Arriba, Abajo.
- **Ajuste:** Contain (color de relleno), Cover, Stretch.
- **Vista:** +Zoom, −Zoom, Ajustar a pantalla, Reset imagen.

## Exportación

```js
const data = await canvasRef.current.exportArtboard({
  scale: 2,
  mime: 'image/png',
  backgroundColor: '#fff'
});
```

- `scale`: multiplicador (1 = 300 DPI aprox.).
- `mime`: `image/png` o `image/jpeg`.
- `quality`: 0–1 (solo JPEG).
- `backgroundColor`: color de fondo al exportar en modo *Contain*.

## Atajos de teclado

- `Space` + arrastrar: pan del lienzo.
- `Ctrl/⌘ +` `+` / `-`: zoom.
- `Ctrl/⌘ + 0`: ajustar a pantalla.
- Flechas (Shift = ×10): mover imagen.

## Nota de migración

Se reemplazó el antiguo componente `Worktable` por `Artboard` e `ImageNode` para una separación más clara de responsabilidades. Se eliminó un `useEffect` que reasignaba la transformación de la imagen en cada render y provocaba que la imagen "volviera" a su preset.
