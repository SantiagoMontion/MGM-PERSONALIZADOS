export default function DebugPanel({ data }) {
  if (!data) return null;
  return (
    <pre style={{ fontSize: '0.8em', background: '#111', color: '#0f0', padding: '10px', overflowX: 'auto' }}>
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}
