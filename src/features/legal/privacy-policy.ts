import { siteConfig } from "@/config/site";

// A Política de Privacidade do produto, como dado: a página só desenha.
//
// RASCUNHO PARA REVISÃO JURÍDICA (Fase 10 de docs/PLANO-IMPLANTACAO.md). Os
// trechos entre [[ ]] são do controlador ou do jurídico (identidade, contato do
// encarregado, prazos, confirmação das bases legais) e precisam ser preenchidos
// antes de publicar. Enquanto houver um, a página se declara rascunho e não é
// indexada (ver `isPolicyDraft`).
//
// Cada afirmação sobre o SISTEMA foi conferida no código em 2026-10-09:
// provedores externos (uazapi, OpenAI, agente de IA, sistema de gestão,
// webhooks), o que é gravado e o que é só consultado, prazos de retenção
// (registros 90 dias, fila 30 dias, backups 30/7 dias, sessão 7 dias), cookies
// e armazenamento local. Mudou o sistema? Mude o texto junto.

export type PolicyBlock = { kind: "p"; text: string } | { kind: "list"; items: string[] };
export type PolicySection = { id: string; title: string; blocks: PolicyBlock[] };

/** Um trecho a preencher: `[[o que falta]]`. */
export const POLICY_PLACEHOLDER = /\[\[([^\]]+)\]\]/g;

const PRODUCT = `${siteConfig.brand} ${siteConfig.name}`;

export const PRIVACY_POLICY: { updatedAt: string; sections: PolicySection[] } = {
  updatedAt: "[[DATA DA PUBLICAÇÃO]]",
  sections: [
    {
      id: "quem-somos",
      title: "Quem somos e a quem esta política se aplica",
      blocks: [
        {
          kind: "p",
          text:
            `O ${PRODUCT} é a ferramenta de atendimento de suporte técnico usada por [[RAZÃO SOCIAL DO CONTROLADOR]], ` +
            "inscrita no CNPJ [[CNPJ DO CONTROLADOR]], com sede em [[ENDEREÇO DO CONTROLADOR]] (“nós”), para atender os " +
            "clientes pelo WhatsApp e organizar os chamados de suporte. Nós somos o controlador dos dados pessoais " +
            "tratados nele, nos termos da Lei Geral de Proteção de Dados (Lei nº 13.709/2018, “LGPD”).",
        },
        {
          kind: "p",
          text:
            "O sistema é desenvolvido e mantido por [[RAZÃO SOCIAL E CNPJ DO OPERADOR — confirmar com o jurídico]], " +
            "que trata os dados em nosso nome e segundo as nossas instruções (operador).",
        },
        {
          kind: "p",
          text:
            "Esta política vale para quem entra em contato com o nosso suporte (e para as empresas que essas pessoas " +
            "representam) e para a nossa equipe, que usa o sistema no dia a dia.",
        },
      ],
    },
    {
      id: "dados",
      title: "Quais dados tratamos",
      blocks: [
        { kind: "p", text: "De quem fala com o suporte:" },
        {
          kind: "list",
          items: [
            "nome e telefone do WhatsApp e, quando a pessoa a deixa visível, a foto do perfil;",
            "e-mail e observações, quando informados ao atendimento;",
            "a empresa a que a pessoa está vinculada;",
            "as mensagens trocadas com o suporte (texto, áudio, imagem, vídeo e documentos), com data, hora e a confirmação de entrega e de leitura;",
            "os chamados abertos: título, descrição, status, prioridade, anexos, o histórico de mudanças e as notas internas da equipe, que nunca são enviadas ao cliente;",
            "visitas, treinamentos e retornos agendados a partir de um chamado.",
          ],
        },
        { kind: "p", text: "Das empresas clientes:" },
        {
          kind: "list",
          items: [
            "razão social, nome fantasia, CNPJ e a situação do contrato de suporte;",
            "quando a integração com o nosso sistema de gestão ([[NOME DO SISTEMA DE GESTÃO]]) está ligada: o cadastro e os contratos consultados nele, com uma cópia dos dados do contrato (número, modalidade, status, vigência e dia de vencimento); e, na tela do atendimento, um resumo dos títulos em aberto (quantidade, valor total e próximo vencimento), consultado na hora e não gravado.",
          ],
        },
        { kind: "p", text: "Da nossa equipe:" },
        {
          kind: "list",
          items: [
            "nome, e-mail, papel no sistema, foto ou cor do perfil e o apelido usado no atendimento;",
            "a senha, guardada apenas de forma irreversível (hash), nunca em texto;",
            "o registro de quem fez cada ação nos chamados e nas conversas.",
          ],
        },
        { kind: "p", text: "Registros técnicos:" },
        {
          kind: "list",
          items: [
            "o registro das integrações (rota chamada, resultado e tempo de resposta), sem o conteúdo das requisições;",
            "o cookie de sessão da equipe e as preferências guardadas no navegador (seção “Cookies e armazenamento no navegador”).",
          ],
        },
      ],
    },
    {
      id: "finalidades",
      title: "Para que usamos os dados e com qual base legal",
      blocks: [
        { kind: "p", text: "[[Jurídico: confirmar as bases legais de cada finalidade.]]" },
        {
          kind: "list",
          items: [
            "Atender e resolver os chamados de suporte, inclusive com visitas, treinamentos e retornos: execução do contrato de suporte ou de procedimentos preliminares a ele (art. 7º, V, da LGPD).",
            "Identificar quem está falando, a empresa e a situação do contrato, para atender mais rápido e com o contexto certo: execução do contrato e legítimo interesse (art. 7º, V e IX).",
            "Fazer a triagem e as primeiras respostas com um assistente automatizado, quando esse recurso estiver ativo: legítimo interesse (art. 7º, IX).",
            "Transcrever um áudio, quando o atendente pede, para registrar o pedido no chamado: legítimo interesse (art. 7º, IX).",
            "Medir o atendimento (volumes, prazos de resposta e de resolução) para melhorá-lo: legítimo interesse (art. 7º, IX).",
            "Manter a segurança do sistema e o registro de quem fez cada ação: legítimo interesse e cumprimento de obrigação legal (art. 7º, IX e II).",
            "Guardar os registros necessários para exercer direitos em processo judicial, administrativo ou arbitral (art. 7º, VI).",
          ],
        },
        { kind: "p", text: "Não vendemos dados pessoais e não os usamos para publicidade." },
      ],
    },
    {
      id: "compartilhamento",
      title: "Com quem compartilhamos",
      blocks: [
        { kind: "p", text: "Só o necessário para cada finalidade, e com estes destinatários:" },
        {
          kind: "list",
          items: [
            "Provedor de conexão do WhatsApp (uazapi), que liga o nosso número de atendimento ao WhatsApp, e o próprio WhatsApp, que tem a sua política de privacidade.",
            "OpenAI (Estados Unidos), apenas quando um atendente pede a transcrição de um áudio: o áudio é enviado para transcrição. É uma transferência internacional de dados (art. 33 da LGPD). [[Jurídico: indicar a garantia da transferência.]]",
            "O assistente de IA que faz a triagem, quando esse recurso estiver ativo: ele recebe as mensagens das conversas que estão com ele e os dados de contexto do cliente (contato, empresa, contrato e chamado em aberto). [[Identificar o fornecedor do assistente, quando houver.]]",
            "O nosso sistema de gestão ([[NOME DO SISTEMA DE GESTÃO]]), quando a integração está ligada: o sistema de suporte envia o telefone ou o CNPJ para consultar o cadastro do cliente.",
            "Sistemas que integramos ao suporte pela API ou por avisos automáticos (webhooks), com acesso limitado por permissão: recebem dados dos chamados, como título, descrição, status e identificadores.",
            "Hospedagem: os dados ficam em servidor de [[PROVEDOR DE HOSPEDAGEM]], em [[PAÍS DO SERVIDOR]].",
            "Autoridades públicas, quando a lei ou uma ordem judicial exigir.",
          ],
        },
      ],
    },
    {
      id: "retencao",
      title: "Por quanto tempo guardamos",
      blocks: [
        {
          kind: "list",
          items: [
            "Conversas, contatos, chamados e anexos: enquanto durar a relação de suporte e pelo prazo necessário para cumprir obrigações legais e exercer direitos, que é de [[PRAZO DEFINIDO PELO CONTROLADOR]]. O sistema não apaga esses dados sozinho: a eliminação antes disso é feita a pedido, pelo canal da seção “Seus direitos”.",
            "Registro das integrações: 90 dias.",
            "Fila de entrega aos sistemas integrados (o que é repassado ao assistente de IA e aos webhooks): 30 dias depois da última mudança.",
            "Cópias de segurança: as do banco de dados por 30 dias e as dos arquivos por 7 dias.",
            "Sessão da equipe: expira em 7 dias.",
          ],
        },
      ],
    },
    {
      id: "seguranca",
      title: "Como protegemos os dados",
      blocks: [
        {
          kind: "list",
          items: [
            "Toda conexão com o sistema é criptografada (HTTPS).",
            "Só a equipe autorizada acessa o painel, com permissões por papel; quem é desativado perde o acesso.",
            "Senhas e chaves de acesso à API são guardadas apenas de forma irreversível (hash); as chaves de acesso têm permissões limitadas.",
            "As credenciais das integrações ficam num cofre criptografado no banco de dados.",
            "Os arquivos das conversas e dos chamados são privados e só abrem por um link temporário, para quem tem acesso autorizado.",
            "Cada ação nos chamados e nas conversas fica registrada com o seu autor.",
            "O banco de dados e os arquivos têm cópia de segurança diária.",
          ],
        },
      ],
    },
    {
      id: "direitos",
      title: "Seus direitos",
      blocks: [
        {
          kind: "p",
          text:
            "Pela LGPD (art. 18), você pode pedir: a confirmação de que tratamos os seus dados e o acesso a eles; a " +
            "correção de dados incompletos, inexatos ou desatualizados; a anonimização, o bloqueio ou a eliminação de " +
            "dados desnecessários, excessivos ou tratados em desconformidade com a lei; a portabilidade; a informação " +
            "sobre com quem compartilhamos; e, quando o tratamento depender do seu consentimento, a revogação dele. Você " +
            "também pode se opor a um tratamento feito com base no legítimo interesse.",
        },
        {
          kind: "p",
          text:
            "Para exercer esses direitos, fale com o nosso encarregado pelo tratamento de dados pessoais, " +
            "[[NOME DO ENCARREGADO]], pelo e-mail [[E-MAIL DO ENCARREGADO — hoje privacidade@spincode.com.br]]. " +
            "Responderemos no prazo da lei. Você também pode apresentar reclamação à Autoridade Nacional de Proteção " +
            "de Dados (ANPD).",
        },
      ],
    },
    {
      id: "automatizado",
      title: "Atendimento automatizado",
      blocks: [
        {
          kind: "p",
          text:
            "Quando o recurso estiver ativo, as primeiras respostas podem vir de um assistente automatizado, que " +
            "também pode abrir e atualizar o seu chamado. Você pode pedir atendimento humano a qualquer momento, e " +
            "pode pedir a revisão de uma decisão tomada apenas de forma automatizada (art. 20 da LGPD). [[Jurídico: " +
            "confirmar este compromisso.]]",
        },
      ],
    },
    {
      id: "cookies",
      title: "Cookies e armazenamento no navegador",
      blocks: [
        {
          kind: "p",
          text:
            "Quem fala com o suporte pelo WhatsApp não recebe cookie nenhum do sistema. No painel da equipe, usamos " +
            "apenas um cookie de sessão, necessário para manter o acesso, e guardamos no navegador duas preferências: " +
            "o tema (claro ou escuro) e se o aviso de instalação do aplicativo foi dispensado. Não usamos cookies de " +
            "publicidade nem ferramentas de rastreamento de terceiros.",
        },
      ],
    },
    {
      id: "menores",
      title: "Crianças e adolescentes",
      blocks: [
        {
          kind: "p",
          text: "O suporte é destinado aos clientes das empresas que atendemos e não é direcionado a crianças e adolescentes.",
        },
      ],
    },
    {
      id: "alteracoes",
      title: "Alterações nesta política",
      blocks: [
        {
          kind: "p",
          text:
            "Podemos atualizar esta política quando o sistema ou a lei mudarem. A data da última atualização fica no " +
            "fim da página, e mudanças relevantes serão comunicadas pelos nossos canais.",
        },
      ],
    },
  ],
};

/** Os trechos ainda a preencher, sem repetição, na ordem em que aparecem. */
export function pendingPolicyPlaceholders(policy = PRIVACY_POLICY): string[] {
  const texts = [
    policy.updatedAt,
    ...policy.sections.flatMap((section) =>
      section.blocks.flatMap((block) => (block.kind === "p" ? [block.text] : block.items))
    ),
  ];
  const found = texts.flatMap((text) => [...text.matchAll(POLICY_PLACEHOLDER)].map((match) => match[1].trim()));
  return [...new Set(found)];
}

/** Rascunho = ainda há trecho a preencher. A página avisa e não é indexada. */
export function isPolicyDraft(policy = PRIVACY_POLICY): boolean {
  return pendingPolicyPlaceholders(policy).length > 0;
}
