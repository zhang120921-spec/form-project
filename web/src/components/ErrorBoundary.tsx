import { Component, type ErrorInfo, type ReactNode } from "react";
import { t } from "@/lib/i18n";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "100vh",
            padding: "var(--space-lg)",
            fontFamily: "system-ui, sans-serif",
            textAlign: "center",
            color: "var(--ink)",
            background: "var(--ground)",
          }}
        >
          <div style={{ fontSize: "2.5rem", marginBottom: "var(--space-md)" }}>
            {t("Something went wrong")}
          </div>
          <p
            style={{
              fontSize: "var(--type-body)",
              color: "var(--ink-2)",
              maxWidth: 480,
              marginBottom: "var(--space-lg)",
              lineHeight: 1.6,
            }}
          >
            {t("An unexpected error occurred. Your session and data are safe — refreshing the page should restore everything.")}
          </p>
          <button
            onClick={this.handleReload}
            style={{
              padding: "12px 32px",
              fontSize: "var(--type-body)",
              fontWeight: 600,
              color: "#fff",
              background: "var(--accent)",
              border: "none",
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            {t("Reload page")}
          </button>
          {this.state.error && (
            <details
              style={{
                marginTop: "var(--space-xl)",
                fontSize: "var(--type-metadata)",
                color: "var(--ink-3)",
                maxWidth: 600,
                textAlign: "left",
              }}
            >
              <summary style={{ cursor: "pointer", marginBottom: 4 }}>
                {t("Technical details")}
              </summary>
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  background: "var(--math-bg)",
                  padding: "var(--space-md)",
                  borderRadius: 4,
                  fontSize: "var(--type-mono)",
                }}
              >
                {this.state.error.message}
                {"\n\n"}
                {this.state.error.stack}
              </pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
