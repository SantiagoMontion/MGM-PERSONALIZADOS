export default function Bridge() {
  return (
    <div
      style={{
        height: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: '#181818',
        color: '#fff',
        textAlign: 'center',
        padding: 24,
      }}
    >
      <div>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            border: '6px solid rgba(255,255,255,.25)',
            borderTopColor: '#fff',
            margin: '0 auto 18px',
            animation: 'spin 1s linear infinite',
          }}
        />
        <h1 style={{ fontSize: 40, margin: 0 }}>
          Estás siendo redirigido…
        </h1>
        <p style={{ opacity: 0.8, marginTop: 8 }}>
          Tu producto se está terminando de crear
        </p>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <script
        dangerouslySetInnerHTML={{
          __html: `
            (function () {
              function go(url) {
                if (typeof url === 'string' && url.startsWith('http')) {
                  location.replace(url);
                }
              }
              window.addEventListener('message', function (event) {
                try {
                  if (event.data && event.data.type === 'go') {
                    go(event.data.url);
                  }
                } catch (_) {
                  // no-op
                }
              });
            })();
          `,
        }}
      />
    </div>
  );
}

