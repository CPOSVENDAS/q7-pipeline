import type { CSSProperties } from "react";
import logoWatermark from "@/assets/logo-watermark.png";

/**
 * Marca d'água de fundo (a logo em opacidade bem baixa) usada nas telas principais
 * do app. A opacidade já vem "assada" no próprio PNG (ver src/assets/logo-watermark.png),
 * então isso aqui só posiciona a imagem — não usa a propriedade CSS `opacity`, que
 * também deixaria o conteúdo por cima mais fraco.
 *
 * Uso: espalhe no elemento raiz de cada tela, junto da classe `bg-background` (uma
 * define a cor de fundo, a outra a imagem — não competem entre si):
 *   <div className="min-h-screen bg-background" style={brandWatermarkStyle}>
 */
export const brandWatermarkStyle: CSSProperties = {
  backgroundImage: `url(${logoWatermark})`,
  backgroundRepeat: "no-repeat",
  backgroundPosition: "center",
  backgroundSize: "min(65vw, 560px)",
};
