// src/pages/Home.jsx
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import UploadStep from '../components/UploadStep';
import EditorCanvas from '../components/EditorCanvas';
import SizeControls from '../components/SizeControls';

export default function Home() {
  const navigate = useNavigate();

  // archivo subido
  const [uploaded, setUploaded] = useState(null);

  // crear ObjectURL una sola vez
  const [imageUrl, setImageUrl] = useState(null);
  useEffect(() => {
    if (uploaded?.file) {
      const url = URL.createObjectURL(uploaded.file);
      setImageUrl(url);
      return () => URL.revokeObjectURL(url);
    } else {
      setImageUrl(null);
    }
  }, [uploaded?.file]);

  // medidas y material (source of truth)
  const [material, setMaterial] = useState('Classic');
  const [mode, setMode] = useState('standard');
  const [size, setSize] = useState({ w: 90, h: 40 });
  const sizeCm = useMemo(() => ({ w: Number(size.w) || 90, h: Number(size.h) || 40 }), [size.w, size.h]);


  return (
    <div>
      <h1>Mousepad Personalizado</h1>

      <UploadStep onUploaded={setUploaded} />

      {uploaded && (
        <>
          {/* Form de medida/material */}
          <SizeControls
            material={material}
            size={size}
            mode={mode}
            onChange={({ material: m, mode: md, w, h }) => {
              setMaterial(m);
              setMode(md);
              setSize({ w, h });
            }}
          />

          {/* Editor (solo canvas) */}
          <EditorCanvas
            imageUrl={imageUrl}
            sizeCm={sizeCm}       // 👈 que no falte
            bleedMm={3}
            dpi={300}
          />

          {/* (Opcional) Botón para continuar usando tu submit existente con layout */}
          <button style={{marginTop:12}}
                  onClick={()=> navigate(`/confirm?job_id=...`)}>
              Continuar
          </button>
        </>
      )}
    </div>
  );
}

