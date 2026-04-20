import { Link } from 'react-router-dom';
import moonIconSrc from '@/assets/icons/luna.svg';
import completedStepIconSrc from '@/icons/pasos.svg';
import brandLogoSrc from '@/icons/Logo.svg';
import styles from './ProgressHeader.module.css';

const FLOW_STEPS = [
  { title: 'Carg\u00E1 tu dise\u00F1o' },
  { title: 'Eleg\u00ED tama\u00F1o y material' },
  { title: 'Confirm\u00E1 y compr\u00E1' },
];

function clampStep(step) {
  const numericStep = Number(step);
  if (!Number.isFinite(numericStep)) return 1;
  return Math.min(FLOW_STEPS.length, Math.max(1, Math.trunc(numericStep)));
}

function SunIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={styles.themeIcon}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  );
}

const TIENDA_URL = 'https://www.notmid.ar';

export default function ProgressHeader({
  currentStep = 1,
  isDarkMode = true,
  onToggleTheme,
  showStepper = true,
  showTiendaLink = false,
}) {
  const resolvedStep = clampStep(currentStep);
  const currentStepTitle = FLOW_STEPS[resolvedStep - 1]?.title || FLOW_STEPS[0].title;
  const themeButtonLabel = isDarkMode ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';
  const headerClasses = [
    styles.header,
    isDarkMode ? styles.headerDark : styles.headerLight,
  ].join(' ');

  return (
    <header className={headerClasses}>
      <div className={styles.mobileBar}>
        <Link
          to="/"
          className={`${styles.brandLink} ${styles.brandCompact}`.trim()}
          aria-label="Ir al inicio de NOTMID"
        >
          <img src={brandLogoSrc} alt="" className={styles.brandMark} aria-hidden="true" />
          <span className={styles.srOnly}>NOTMID</span>
        </Link>

        <div className={styles.mobileActions}>
          {showStepper && (
            <>
              <span className={styles.srOnly}>
                {`Paso ${resolvedStep} de ${FLOW_STEPS.length}: ${currentStepTitle}`}
              </span>
              <div className={styles.mobileStepper} aria-hidden="true">
                {FLOW_STEPS.map((step, index) => {
                  const stepNumber = index + 1;
                  const isCurrent = stepNumber === resolvedStep;
                  const isCompleted = stepNumber < resolvedStep;
                  const dotClasses = [
                    styles.mobileDot,
                    isCurrent ? styles.mobileDotCurrent : '',
                    isCompleted ? styles.mobileDotComplete : '',
                  ]
                    .filter(Boolean)
                    .join(' ');

                  return <span key={step.title} className={dotClasses} />;
                })}
              </div>
            </>
          )}

          {showTiendaLink ? (
            <a
              href={TIENDA_URL}
              className={styles.tiendaLink}
              aria-label="Ir a la tienda NOTMID (notmid.ar)"
            >
              Tienda
            </a>
          ) : null}

          <button
            type="button"
            aria-label={themeButtonLabel}
            aria-pressed={!isDarkMode}
            title={themeButtonLabel}
            className={styles.themeButton}
            onClick={onToggleTheme}
          >
            {isDarkMode ? (
              <SunIcon />
            ) : (
              <img
                src={moonIconSrc}
                alt=""
                className={`${styles.themeIcon} ${styles.themeIconImage}`.trim()}
                aria-hidden="true"
              />
            )}
          </button>
        </div>
      </div>

      <div className={styles.desktopBar}>
        <div className={styles.desktopInner}>
          <Link
            to="/"
            className={styles.brandLink}
            aria-label="Ir al inicio de NOTMID"
          >
            <img src={brandLogoSrc} alt="" className={styles.brandMark} aria-hidden="true" />
            <span className={styles.srOnly}>NOTMID</span>
          </Link>

          {showStepper ? (
            <nav className={styles.stepper} aria-label="Progreso de compra">
              <ol className={styles.stepList}>
                {FLOW_STEPS.map((step, index) => {
                  const stepNumber = index + 1;
                  const isCurrent = stepNumber === resolvedStep;
                  const isCompleted = stepNumber < resolvedStep;
                  const stepLabelClasses = [
                    styles.stepTitle,
                    isCurrent ? styles.stepTitleCurrent : '',
                    isCompleted ? styles.stepTitleComplete : '',
                    !isCurrent && !isCompleted ? styles.stepTitlePending : '',
                  ]
                    .filter(Boolean)
                    .join(' ');
                  const markerClasses = [
                    styles.stepMarker,
                    styles.stepMarkerPending,
                  ].join(' ');
                  const connectorClasses = [
                    styles.stepConnector,
                    stepNumber < resolvedStep ? styles.stepConnectorComplete : '',
                  ]
                    .filter(Boolean)
                    .join(' ');

                  return (
                    <li
                      key={step.title}
                      className={styles.stepItem}
                      aria-current={isCurrent ? 'step' : undefined}
                    >
                      <div className={styles.stepMain}>
                        {isCurrent ? (
                          <span className={styles.stepBadge}>{`Paso ${stepNumber}`}</span>
                        ) : isCompleted ? (
                          <span className={styles.stepMarkerCompleteIcon} aria-hidden="true">
                            <img
                              src={completedStepIconSrc}
                              alt=""
                              className={styles.stepMarkerCompleteIconImage}
                            />
                          </span>
                        ) : (
                          <span className={markerClasses} aria-hidden="true" />
                        )}
                        <span className={stepLabelClasses}>{step.title}</span>
                      </div>
                      {index < FLOW_STEPS.length - 1 && (
                        <span className={connectorClasses} aria-hidden="true" />
                      )}
                    </li>
                  );
                })}
              </ol>
            </nav>
          ) : showTiendaLink ? (
            <div className={styles.stepper}>
              <a
                href={TIENDA_URL}
                className={styles.tiendaLink}
                aria-label="Ir a la tienda NOTMID (notmid.ar)"
              >
                Tienda
              </a>
            </div>
          ) : (
            <div className={styles.stepperSpacer} aria-hidden="true" />
          )}

          <button
            type="button"
            aria-label={themeButtonLabel}
            aria-pressed={!isDarkMode}
            title={themeButtonLabel}
            className={styles.themeButton}
            onClick={onToggleTheme}
          >
            {isDarkMode ? (
              <SunIcon />
            ) : (
              <img
                src={moonIconSrc}
                alt=""
                className={`${styles.themeIcon} ${styles.themeIconImage}`.trim()}
                aria-hidden="true"
              />
            )}
          </button>
        </div>
      </div>
    </header>
  );
}

