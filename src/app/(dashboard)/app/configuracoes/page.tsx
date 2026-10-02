import { redirect } from "next/navigation";

import { urlTabHref } from "@/components/layout/url-tab-state";
import { CONNECTION_TABS } from "@/features/connection/lib/connection-tabs";

/**
 * Endereço antigo. Variáveis, API do CRM e Agente de IA foram para as abas de
 * /app/conexao (Integrações); aqui fica só o Atendimento, em
 * /app/configuracoes/atendimento. Quem tem o link salvo cai na aba que esta
 * página abria por padrão (Variáveis). Não lê nada: a página de destino confere
 * o administrador.
 *
 * `redirect` (307), e não `permanentRedirect`: o navegador guardaria o 308 para
 * sempre, e o endereço ficaria preso se um dia voltar a ter página.
 */
export default function ConfiguracoesPage(): never {
  redirect(urlTabHref(CONNECTION_TABS, "/app/conexao", "variaveis"));
}
