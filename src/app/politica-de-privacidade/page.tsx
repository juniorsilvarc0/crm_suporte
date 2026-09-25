import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowUpRight,
  Ban,
  Clock,
  Database,
  Lock,
  Scale,
  Share2,
  UserCheck,
} from "lucide-react";

import { LogoMark } from "@/components/ui/logo-mark";
import { siteConfig } from "@/config/site";

const CONTACT_EMAIL = "privacidade@spincode.com.br";
const LAST_UPDATE = "17 de agosto de 2026";
const VERSION = "1.0";

export const metadata: Metadata = {
  title: "Política de Privacidade",
  description: `Como a ${siteConfig.name} trata dados pessoais no CRM e na integração com WhatsApp e Meta.`,
  robots: { index: true, follow: true },
};

const sections = [
  { id: "quem-trata", label: "Quem trata seus dados" },
  { id: "dados", label: "Dados que tratamos" },
  { id: "origem", label: "De onde vêm" },
  { id: "finalidades", label: "Finalidades e base legal" },
  { id: "meta", label: "O que enviamos à Meta" },
  { id: "terceiros", label: "Com quem compartilhamos" },
  { id: "retencao", label: "Por quanto tempo guardamos" },
  { id: "seguranca", label: "Segurança" },
  { id: "direitos", label: "Seus direitos" },
  { id: "cookies", label: "Cookies" },
  { id: "menores", label: "Menores de idade" },
  { id: "mudancas", label: "Mudanças nesta política" },
  { id: "contato", label: "Contato" },
];

const dataGroups = [
  {
    icon: UserCheck,
    title: "Identificação e contato",
    body: "Nome, número de telefone do WhatsApp e, quando você informa, e-mail e data de nascimento.",
  },
  {
    icon: Database,
    title: "Conteúdo do atendimento",
    body: "As mensagens trocadas na conversa, os arquivos enviados nela, os agendamentos marcados e as anotações que a equipe registra sobre o atendimento.",
  },
  {
    icon: Share2,
    title: "Origem publicitária",
    body: "Quando você chega por um anúncio, recebemos da Meta um identificador do clique e o identificador do anúncio, do conjunto e da campanha. O identificador do clique é pseudônimo: sozinho, não diz quem você é.",
  },
  {
    icon: Lock,
    title: "Registros técnicos",
    body: "Data, hora e endereço IP dos acessos ao painel usado pela equipe da clínica. Não coletamos esses registros de quem apenas conversa pelo WhatsApp.",
  },
];

const legalBasis = [
  {
    purpose: "Responder sua mensagem e conduzir o atendimento",
    basis: "Procedimentos preliminares a contrato — art. 7º, V",
  },
  {
    purpose: "Marcar, confirmar e lembrar consultas",
    basis: "Execução de contrato — art. 7º, V",
  },
  {
    purpose: "Registrar informação de saúde necessária ao atendimento",
    basis: "Tutela da saúde, por profissional de saúde — art. 11, II, f",
  },
  {
    purpose: "Medir qual anúncio originou o contato e devolver essa medição à Meta",
    basis: "Legítimo interesse — art. 7º, IX",
  },
  {
    purpose: "Guardar registros exigidos por lei ou por autoridade",
    basis: "Cumprimento de obrigação legal — art. 7º, II",
  },
];

const sentToMeta = [
  "O nome do evento: contato recebido ou lead qualificado",
  "A data e a hora em que ele aconteceu",
  "Um identificador único do evento, para evitar contagem repetida",
  "O identificador do clique no anúncio",
  "O identificador da conta comercial de WhatsApp",
];

const neverSentToMeta = [
  "Nome, telefone, e-mail ou qualquer dado que identifique você",
  "O conteúdo das mensagens, em texto, áudio, imagem ou arquivo",
  "Sintoma, queixa, exame, diagnóstico, indicação ou procedimento",
  "Anotações da equipe, etiquetas e qualquer campo de texto livre",
];

const rights = [
  "Confirmar que tratamos dados seus",
  "Acessar os dados que temos",
  "Corrigir dado incompleto, inexato ou desatualizado",
  "Pedir anonimização, bloqueio ou eliminação de dado desnecessário ou tratado fora da lei",
  "Pedir portabilidade a outro fornecedor",
  "Pedir eliminação dos dados tratados com base no seu consentimento",
  "Saber com quem compartilhamos seus dados",
  "Ser informado sobre a possibilidade de não consentir e o que acontece se negar",
  "Revogar o consentimento",
  "Opor-se a tratamento feito com base em legítimo interesse",
];

export default function PoliticaDePrivacidadePage() {
  return (
    <main className="min-h-dvh bg-transparent text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto w-full max-w-6xl px-6 py-12 lg:py-16">
          <Link
            href="/login"
            className="inline-flex items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <LogoMark size={40} aria-label={siteConfig.name} className="shrink-0" />
            <span className="text-sm font-semibold">{siteConfig.name}</span>
          </Link>

          <h1 className="mt-9 max-w-3xl text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Política de Privacidade
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-7 text-muted-foreground">
            Este documento explica quais dados pessoais passam pelo CRM da{" "}
            {siteConfig.name}, por que passam, com quem são compartilhados e por
            quanto tempo ficam guardados.
          </p>

          <dl className="mt-9 flex flex-wrap gap-x-12 gap-y-3 text-sm">
            <div>
              <dt className="text-muted-foreground">Última atualização</dt>
              <dd className="mt-1 font-medium">{LAST_UPDATE}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Versão</dt>
              <dd className="mt-1 font-medium">{VERSION}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Encarregado</dt>
              <dd className="mt-1 font-medium">
                <a
                  className="rounded-sm underline decoration-border underline-offset-4 outline-none transition-colors hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  href={`mailto:${CONTACT_EMAIL}`}
                >
                  {CONTACT_EMAIL}
                </a>
              </dd>
            </div>
          </dl>
        </div>
      </header>

      <div className="mx-auto w-full max-w-6xl px-6 py-12 lg:grid lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] lg:gap-12 lg:py-16">
        <nav aria-label="Seções desta política" className="hidden lg:block">
          <div className="sticky top-12">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Nesta página
            </p>
            <ul className="mt-6 space-y-1 border-l border-border">
              {sections.map((section) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="-ms-px block border-l border-transparent py-1.5 ps-6 text-sm text-muted-foreground outline-none transition-colors hover:border-foreground hover:text-foreground focus-visible:border-ring focus-visible:text-foreground"
                  >
                    {section.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </nav>

        <article className="max-w-3xl [&_h2]:scroll-mt-12">
          <div className="rounded-xl border border-border bg-muted/40 p-6">
            <h2 className="text-sm font-semibold">Resumo honesto</h2>
            <p className="mt-3 text-base leading-7 text-muted-foreground">
              Guardamos o que você escreve para a clínica poder te atender, e
              medimos qual anúncio te trouxe. Para a Meta vai apenas o aviso de
              que um contato aconteceu, junto de um código do clique. Nada do que
              você conta sobre sua saúde sai daqui. O código do clique é apagado
              em 90 dias.
            </p>
          </div>

          <section id="quem-trata" className="mt-12">
            <h2 className="text-xl font-semibold tracking-tight">
              1. Quem trata seus dados
            </h2>
            <p className="mt-4 text-base leading-7 text-muted-foreground">
              A {siteConfig.name} desenvolve e opera o CRM que a clínica usa para
              atender pelo WhatsApp. Nessa relação existem dois papéis, e eles
              importam para você saber a quem recorrer.
            </p>
            <div className="mt-6 grid gap-px overflow-hidden rounded-xl border border-border/60 bg-border shadow-soft sm:grid-cols-2">
              <div className="bg-card p-6">
                <p className="text-sm font-semibold">A clínica é a controladora</p>
                <p className="mt-3 text-base leading-7 text-muted-foreground">
                  É ela quem decide por que e como seus dados são tratados. É
                  também ela quem responde pelo conteúdo clínico do atendimento.
                </p>
              </div>
              <div className="bg-card p-6">
                <p className="text-sm font-semibold">
                  A {siteConfig.name} é a operadora
                </p>
                <p className="mt-3 text-base leading-7 text-muted-foreground">
                  Tratamos os dados em nome da clínica, seguindo as instruções
                  dela e os limites descritos aqui. Não usamos seus dados para
                  finalidade própria.
                </p>
              </div>
            </div>
            <p className="mt-6 text-base leading-7 text-muted-foreground">
              Você pode exercer seus direitos com qualquer um dos dois. Se
              escrever para nós, encaminhamos à clínica quando a decisão for
              dela.
            </p>
          </section>

          <section id="dados" className="mt-12">
            <h2 className="text-xl font-semibold tracking-tight">
              2. Dados que tratamos
            </h2>
            <div className="mt-6 space-y-6">
              {dataGroups.map((group) => (
                <div key={group.title} className="flex gap-6">
                  <div
                    aria-hidden="true"
                    className="mt-1 flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/60"
                  >
                    <group.icon className="size-4 text-primary" strokeWidth={1.75} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{group.title}</p>
                    <p className="mt-2 text-base leading-7 text-muted-foreground">
                      {group.body}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section id="origem" className="mt-12">
            <h2 className="text-xl font-semibold tracking-tight">
              3. De onde vêm
            </h2>
            <ul className="mt-6 space-y-3 text-base leading-7 text-muted-foreground">
              <li className="border-l border-border ps-6">
                De você, quando escreve para a clínica no WhatsApp.
              </li>
              <li className="border-l border-border ps-6">
                Da Meta, quando você chega por um anúncio de clique para
                WhatsApp. Nesse caso a própria mensagem já vem acompanhada da
                identificação do anúncio.
              </li>
              <li className="border-l border-border ps-6">
                Da equipe da clínica, quando registra no CRM algo apurado durante
                o atendimento.
              </li>
            </ul>
          </section>

          <section id="finalidades" className="mt-12">
            <h2 className="text-xl font-semibold tracking-tight">
              4. Finalidades e base legal
            </h2>
            <p className="mt-4 text-base leading-7 text-muted-foreground">
              Cada tratamento tem uma finalidade declarada e uma hipótese legal
              da Lei Geral de Proteção de Dados que o autoriza.
            </p>
            <div className="mt-6 overflow-hidden rounded-xl border border-border/60 shadow-soft">
              <table className="w-full border-collapse text-left">
                <caption className="sr-only">
                  Finalidades de tratamento e respectivas bases legais
                </caption>
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th scope="col" className="p-6 text-sm font-semibold">
                      Para quê
                    </th>
                    <th scope="col" className="p-6 text-sm font-semibold">
                      Base legal
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {legalBasis.map((row) => (
                    <tr
                      key={row.purpose}
                      className="border-b border-border last:border-b-0"
                    >
                      <td className="p-6 align-top text-base leading-7">
                        {row.purpose}
                      </td>
                      <td className="p-6 align-top text-base leading-7 text-muted-foreground">
                        {row.basis}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section id="meta" className="mt-12">
            <h2 className="text-xl font-semibold tracking-tight">
              5. O que enviamos à Meta
            </h2>
            <p className="mt-4 text-base leading-7 text-muted-foreground">
              Quando a clínica anuncia no Facebook ou no Instagram, ela precisa
              saber quais anúncios geram atendimento de verdade. Para isso
              devolvemos à Meta o aviso de que um contato aconteceu. O envio é
              deliberadamente mínimo: existe uma lista fechada de campos, e nada
              fora dela pode sair.
            </p>

            <div className="mt-6 grid gap-px overflow-hidden rounded-xl border border-border/60 bg-border shadow-soft lg:grid-cols-2">
              <div className="bg-card p-6">
                <div className="flex items-center gap-3">
                  <Share2 className="size-4 text-primary" strokeWidth={1.75} aria-hidden="true" />
                  <p className="text-sm font-semibold">O que sai</p>
                </div>
                <ul className="mt-4 space-y-3 text-base leading-7 text-muted-foreground">
                  {sentToMeta.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div className="bg-card p-6">
                <div className="flex items-center gap-3">
                  <Ban className="size-4 text-destructive" strokeWidth={1.75} aria-hidden="true" />
                  <p className="text-sm font-semibold">O que nunca sai</p>
                </div>
                <ul className="mt-4 space-y-3 text-base leading-7 text-muted-foreground">
                  {neverSentToMeta.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>

            <p className="mt-6 text-base leading-7 text-muted-foreground">
              O tratamento que a Meta faz desses dados segue as políticas dela.
              Você pode consultá-las em{" "}
              <a
                className="inline-flex items-center gap-1 rounded-sm font-medium text-foreground underline decoration-border underline-offset-4 outline-none transition-colors hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring"
                href="https://www.facebook.com/privacy/policy"
                target="_blank"
                rel="noreferrer noopener"
              >
                facebook.com/privacy/policy
                <ArrowUpRight className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
              </a>
              .
            </p>
          </section>

          <section id="terceiros" className="mt-12">
            <h2 className="text-xl font-semibold tracking-tight">
              6. Com quem compartilhamos
            </h2>
            <p className="mt-4 text-base leading-7 text-muted-foreground">
              Não vendemos dados pessoais e não os cedemos para publicidade de
              terceiros. O compartilhamento se limita a quem é necessário para o
              serviço funcionar:
            </p>
            <ul className="mt-6 space-y-3 text-base leading-7 text-muted-foreground">
              <li className="border-l border-border ps-6">
                <span className="font-medium text-foreground">Meta</span> —
                entrega das mensagens pela WhatsApp Business Platform e medição
                de anúncios, nos limites da seção anterior.
              </li>
              <li className="border-l border-border ps-6">
                <span className="font-medium text-foreground">Supabase</span> —
                banco de dados gerenciado onde os registros ficam armazenados.
              </li>
              <li className="border-l border-border ps-6">
                <span className="font-medium text-foreground">
                  Provedor de infraestrutura
                </span>{" "}
                — hospedagem da aplicação em servidor no Brasil.
              </li>
              <li className="border-l border-border ps-6">
                <span className="font-medium text-foreground">
                  Autoridade pública
                </span>{" "}
                — apenas mediante ordem legal, e no limite do que for exigido.
              </li>
            </ul>
          </section>

          <section id="retencao" className="mt-12">
            <h2 className="text-xl font-semibold tracking-tight">
              7. Por quanto tempo guardamos
            </h2>
            <div className="mt-6 flex gap-6 rounded-xl border border-border bg-muted/40 p-6">
              <Clock
                className="mt-1 size-4 shrink-0 text-primary"
                strokeWidth={1.75}
                aria-hidden="true"
              />
              <div>
                <p className="text-sm font-semibold">
                  Identificador do clique: 90 dias
                </p>
                <p className="mt-3 text-base leading-7 text-muted-foreground">
                  Passado esse prazo, o valor é apagado automaticamente do banco.
                  Fica apenas a informação de que aquele contato veio de anúncio,
                  sem o código que o ligava ao clique.
                </p>
              </div>
            </div>
            <p className="mt-6 text-base leading-7 text-muted-foreground">
              O histórico de atendimento e os agendamentos ficam guardados
              enquanto durar a relação com a clínica e pelos prazos que a
              legislação impuser, inclusive os prazos de guarda de registro em
              saúde. Encerrado o prazo, os dados são eliminados ou anonimizados.
              Quem define esses prazos é a clínica, na condição de controladora.
            </p>
          </section>

          <section id="seguranca" className="mt-12">
            <h2 className="text-xl font-semibold tracking-tight">
              8. Segurança
            </h2>
            <ul className="mt-6 space-y-3 text-base leading-7 text-muted-foreground">
              <li className="border-l border-border ps-6">
                Todo tráfego trafega cifrado por HTTPS.
              </li>
              <li className="border-l border-border ps-6">
                O acesso ao painel exige autenticação e é limitado por papel:
                cada pessoa da equipe enxerga apenas o que o papel dela permite.
              </li>
              <li className="border-l border-border ps-6">
                As notificações recebidas da Meta são verificadas por assinatura
                criptográfica antes de qualquer leitura. Requisição sem
                assinatura válida é recusada.
              </li>
              <li className="border-l border-border ps-6">
                O identificador do clique fica restrito ao servidor. Ele não
                aparece em tela, em exportação de planilha nem em registro de
                erro.
              </li>
            </ul>
            <p className="mt-6 text-base leading-7 text-muted-foreground">
              Nenhuma medida elimina risco por completo. Se ocorrer incidente de
              segurança com risco relevante a você, comunicamos a clínica para
              que ela notifique você e a Autoridade Nacional de Proteção de
              Dados, na forma da lei.
            </p>
          </section>

          <section id="direitos" className="mt-12">
            <h2 className="text-xl font-semibold tracking-tight">
              9. Seus direitos
            </h2>
            <p className="mt-4 text-base leading-7 text-muted-foreground">
              O artigo 18 da Lei Geral de Proteção de Dados garante a você:
            </p>
            <ul className="mt-6 grid gap-3 sm:grid-cols-2">
              {rights.map((right) => (
                <li
                  key={right}
                  className="flex gap-3 rounded-lg border border-border bg-card p-6 text-base leading-7 text-muted-foreground"
                >
                  <Scale
                    className="mt-1.5 size-4 shrink-0 text-primary"
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                  <span>{right}</span>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-base leading-7 text-muted-foreground">
              Para exercer qualquer um deles, escreva para{" "}
              <a
                className="rounded-sm font-medium text-foreground underline decoration-border underline-offset-4 outline-none transition-colors hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring"
                href={`mailto:${CONTACT_EMAIL}`}
              >
                {CONTACT_EMAIL}
              </a>
              . Respondemos em até 15 dias. Podemos pedir informação que confirme
              sua identidade antes de atender, justamente para não entregar seus
              dados a outra pessoa.
            </p>
          </section>

          <section id="cookies" className="mt-12">
            <h2 className="text-xl font-semibold tracking-tight">
              10. Cookies
            </h2>
            <p className="mt-4 text-base leading-7 text-muted-foreground">
              O painel usa um cookie de sessão, necessário para manter a equipe
              autenticada. Ele não serve para publicidade e não acompanha você
              por outros sites. Esta página não usa cookie algum.
            </p>
          </section>

          <section id="menores" className="mt-12">
            <h2 className="text-xl font-semibold tracking-tight">
              11. Menores de idade
            </h2>
            <p className="mt-4 text-base leading-7 text-muted-foreground">
              O atendimento é destinado a maiores de 18 anos. Quando envolve
              menor, o tratamento depende do consentimento específico de ao menos
              um dos pais ou do responsável legal, e sempre no melhor interesse
              do menor.
            </p>
          </section>

          <section id="mudancas" className="mt-12">
            <h2 className="text-xl font-semibold tracking-tight">
              12. Mudanças nesta política
            </h2>
            <p className="mt-4 text-base leading-7 text-muted-foreground">
              Quando mudarmos algo relevante, publicamos a nova versão nesta
              mesma página com data e número atualizados. Vale sempre a versão
              publicada aqui.
            </p>
          </section>

          <section id="contato" className="mt-12">
            <h2 className="text-xl font-semibold tracking-tight">13. Contato</h2>
            <div className="mt-6 rounded-xl border border-border/60 bg-card shadow-soft p-6">
              <p className="text-base leading-7 text-muted-foreground">
                Dúvida, pedido ou reclamação sobre dados pessoais:
              </p>
              <a
                className="mt-3 inline-flex items-center gap-1.5 rounded-sm text-base font-medium underline decoration-border underline-offset-4 outline-none transition-colors hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring"
                href={`mailto:${CONTACT_EMAIL}`}
              >
                {CONTACT_EMAIL}
                <ArrowUpRight className="size-4" strokeWidth={1.75} aria-hidden="true" />
              </a>
              <p className="mt-6 text-base leading-7 text-muted-foreground">
                Se preferir tratar diretamente com a clínica, que é a
                controladora dos dados, use os canais de atendimento dela.
              </p>
            </div>
          </section>
        </article>
      </div>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-6 py-12 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>
            {siteConfig.name} · Versão {VERSION} · {LAST_UPDATE}
          </p>
          <Link
            className="rounded-sm underline decoration-border underline-offset-4 outline-none transition-colors hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring"
            href="/login"
          >
            Acessar o painel
          </Link>
        </div>
      </footer>
    </main>
  );
}
