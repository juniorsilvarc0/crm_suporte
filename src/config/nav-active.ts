/**
 * Início é a raiz de todas as rotas do app, não a seção-mãe delas: só acende
 * nele mesmo. Senão uma rota fora do menu acenderia "Início" por prefixo.
 */
const HOME_HREF = "/app";

/**
 * O href casa com a rota quando é a própria rota ou um ancestral dela **por
 * segmento**: `/app/tickets` casa com `/app/tickets/1024`, mas não com
 * `/app/ticketsx`.
 */
export function matchesNavHref(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  if (href === HOME_HREF) return false;
  return pathname.startsWith(`${href}/`);
}

/**
 * O item que acende é o de href **mais longo** entre os que casam. Com prefixo
 * simples, Tickets (`/app/tickets`) e Quadro (`/app/tickets/quadro`) acenderiam
 * juntos; assim, só o mais específico. Rota que nenhum item cobre → `null`.
 *
 * Recebe a lista inteira da navegação (inclusive o Perfil): a barra inferior e
 * os menus são recortes dela, e decidir por recorte acenderia o ancestral de
 * uma rota cujo item mora em outra superfície.
 */
export function getActiveNavHref(pathname: string, hrefs: ReadonlyArray<string>): string | null {
  let active: string | null = null;
  for (const href of hrefs) {
    if (matchesNavHref(pathname, href) && (active === null || href.length > active.length)) {
      active = href;
    }
  }
  return active;
}
