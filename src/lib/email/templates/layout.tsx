import * as React from 'react';

/**
 * Shared email layout. Inline styles only — most email clients strip
 * <style> tags and don't reliably support external CSS. Layout uses a
 * single centered table (the historically least-broken approach across
 * Outlook, Gmail, iOS Mail).
 */
export function EmailLayout({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <title>{title}</title>
      </head>
      <body style={styles.body}>
        <table role="presentation" cellPadding={0} cellSpacing={0} style={styles.wrapper}>
          <tbody>
            <tr>
              <td style={styles.card}>
                <h1 style={styles.heading}>{title}</h1>
                {children}
                <p style={styles.footer}>ОТСфера · personal cabinet</p>
              </td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  );
}

export const emailStyles = {
  paragraph: {
    fontSize: 15,
    lineHeight: 1.5,
    margin: '0 0 16px',
  } as React.CSSProperties,
  button: {
    display: 'inline-block',
    padding: '10px 18px',
    borderRadius: 8,
    backgroundColor: '#F97316',
    color: '#ffffff',
    textDecoration: 'none',
    fontWeight: 600,
  } as React.CSSProperties,
  muted: {
    fontSize: 12,
    color: '#6b7280',
    margin: '24px 0 0',
  } as React.CSSProperties,
  mono: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    wordBreak: 'break-all',
  } as React.CSSProperties,
};

const styles = {
  body: {
    margin: 0,
    padding: '24px 0',
    backgroundColor: '#f7f7f8',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    color: '#111827',
  } as React.CSSProperties,
  wrapper: {
    margin: '0 auto',
    width: '100%',
    maxWidth: 560,
  } as React.CSSProperties,
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 32,
    border: '1px solid #e5e7eb',
  } as React.CSSProperties,
  heading: {
    fontSize: 20,
    fontWeight: 600,
    margin: '0 0 16px',
    color: '#111827',
  } as React.CSSProperties,
  footer: {
    fontSize: 11,
    color: '#9ca3af',
    margin: '32px 0 0',
    borderTop: '1px solid #f3f4f6',
    paddingTop: 16,
  } as React.CSSProperties,
};
