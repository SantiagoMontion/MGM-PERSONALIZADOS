import styles from './Footer.module.css';

const sections = [
  {
    title: 'Más de nosotros',
    links: [
      { label: 'Nuestros productos' },
      { label: 'Instagram' },
      { label: 'Facebook' },
      { label: 'TikTok' },
    ],
  },
  {
    title: '¿Necesitás ayuda?',
    links: [
      { label: 'Ayuda' },
      { label: 'Contactanos' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'ARCA' },
      { label: 'Términos y Condiciones' },
    ],
  },
];

export default function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.topRow}>
        <div className={styles.linkColumns}>
          {sections.map((section) => (
            <div key={section.title} className={styles.column}>
              <h3 className={styles.columnTitle}>{section.title}</h3>
              <ul className={styles.linkList}>
                {section.links.map((item) => (
                  <li key={item.label}>
                    <a href="" className={styles.link}>
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className={styles.locationWrapper}>
          <span className={styles.location}>San Juan, Argentina</span>
        </div>
      </div>
      <div className={styles.bottomRow}>
        <span className={styles.copyright}>
          © 2025 MGM Gamers. Todos los derechos reservados.
        </span>
      </div>
    </footer>
  );
}
