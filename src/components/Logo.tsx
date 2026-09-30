import logoMark from "@/assets/logo-mark.png";

interface LogoProps {
  width?: number;
  height?: number;
  className?: string;
  showTitle?: boolean;
  iconSize?: number;
  /** Compact inline layout (icon + wordmark on one line). Use in headers/navbars. */
  horizontal?: boolean;
}

/**
 * Marca da CPOS Vendas: a arte que o usuário criou (pomba/nó em degradê azul-petróleo)
 * foi recolorida para a paleta laranja + preto do sistema, mantendo o desenho original
 * (ver src/assets/logo-mark.png). Se uma nova versão da logo chegar, basta substituir
 * esse arquivo — nada mais aqui precisa mudar.
 */
function Mark({ size }: { size: number }) {
  return (
    <img
      src={logoMark}
      alt="CPOS Vendas"
      className="shrink-0 object-contain"
      style={{ width: size, height: size }}
      draggable={false}
    />
  );
}

export const Logo = ({
  iconSize = 96,
  className = "",
  showTitle = true,
  width,
  height,
  horizontal = false,
}: LogoProps) => {
  const size = width ?? height ?? iconSize;

  if (horizontal) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <Mark size={size} />
        {showTitle && (
          <span className="font-sans font-bold uppercase tracking-tight leading-none text-foreground text-lg sm:text-xl">
            CPOS Vendas
          </span>
        )}
      </div>
    );
  }

  return (
    <div className={`flex flex-col items-center gap-4 ${className}`}>
      <Mark size={size} />
      {showTitle && (
        <div className="flex flex-col items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-[0.3em] text-muted-foreground">
            Atendimento &amp; Vendas
          </span>
          <span className="font-sans font-bold uppercase tracking-tight leading-none text-foreground text-4xl sm:text-5xl">
            CPOS Vendas
          </span>
        </div>
      )}
    </div>
  );
};
