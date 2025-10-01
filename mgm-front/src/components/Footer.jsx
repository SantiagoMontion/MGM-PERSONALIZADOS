import { Link } from 'react-router-dom';
import styles from './Footer.module.css';

const sections = [
  {
    title: 'Más de nosotros',
    links: [
      { label: 'Nuestros productos', href: 'https://mgmgamers.store/collections/todos-los-mousepads', external: true },                    // interno
      { label: 'Instagram', href: 'https://instagram.com/mgmgamers.store', external: true },
      { label: 'TikTok',    href: 'https://www.tiktok.com/@mgmgamers', external: true },
    ],
  },
  {
    title: '¿Necesitás ayuda?',
    links: [
      { label: 'Cuidados', href: 'https://mgmgamers.store/pages/cuidados', external: true },                            // interno
      { label: 'Contactanos', href: 'https://mgmgamers.store/pages/contact', external: true },
    ],
  },
  {
    title: 'Legal',
    links: [
      
      { label: 'Términos y Condiciones', href: 'https://mgmgamers.store/blogs/noticias/terminos-y-condiciones', external: true },
    ],
  },
];

// Link inteligente
function SmartLink({ item, className, children }) {
  if (item.to) {
    return <Link to={item.to} className={className}>{children}</Link>;
  }
  // externo o absoluto
  const target = item.external ? '_blank' : '_self';
  const rel = item.external ? 'noopener noreferrer' : undefined;
  return (
    <a href={item.href || '#'} target={target} rel={rel} className={className}>
      {children}
    </a>
  );
}

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
                    <SmartLink item={item} className={styles.link}>
                      {item.label}
                    </SmartLink>
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
