defmodule App.Workers.Mailer do
  use Oban.Worker, queue: :mailers

  # Allow use of sigil_p/2
  use Phoenix.VerifiedRoutes,
    endpoint: AppWeb.Endpoint,
    router: AppWeb.Router,
    statics: AppWeb.static_paths()

  alias App.Accounts.User
  alias App.Jwt

  # Mail Types
  @update_email_instructions "update_email_instructions"
  @magic_link_instructions "magic_link_instructions"
  @confirmation_instructions "confirmation_instructions"

  @impl Oban.Worker
  def timeout(_job), do: :timer.minutes(5)

  @impl Oban.Worker
  def perform(%Oban.Job{
        args: %{
          "job_name" => @update_email_instructions,
          "recipient_email" => recipient_email,
          "url" => url
        }
      }) do
    create_claims(
      sender: "verify",
      recipient_email: recipient_email,
      subject: "Update email instructions",
      text_body: update_email_instructions_text(url),
      html_body: update_email_instructions_html(url)
    )
    |> send_email()
  end

  def perform(%Oban.Job{
        args: %{
          "job_name" => @magic_link_instructions,
          "recipient_email" => recipient_email,
          "url" => url
        }
      }) do
    create_claims(
      sender: "verify",
      recipient_email: recipient_email,
      subject: "Log in instructions",
      text_body: magic_link_instructions_text(url),
      html_body: magic_link_instructions_html(url)
    )
    |> send_email()
  end

  def perform(%Oban.Job{
        args: %{
          "job_name" => @confirmation_instructions,
          "recipient_email" => recipient_email,
          "url" => url
        }
      }) do
    create_claims(
      sender: "verify",
      recipient_email: recipient_email,
      subject: "Confirmation instructions",
      text_body: confirmation_instructions_text(url),
      html_body: confirmation_instructions_html(url)
    )
    |> send_email()
  end

  defp create_claims(options) do
    sender = Keyword.fetch!(options, :sender)
    recipient_email = Keyword.fetch!(options, :recipient_email)
    subject = Keyword.fetch!(options, :subject)
    text = Keyword.fetch!(options, :text_body)
    html = Keyword.fetch!(options, :html_body)

    %{
      "app" => "All Things Web Hackathon App",
      "sender" =>
        "#{Application.fetch_env!(:app, :mail_from_name)} <#{sender}@#{Application.fetch_env!(:app, :mail_from_domain)}>",
      "recipient" => "<#{recipient_email}>",
      "replyTo" =>
        "#{Application.fetch_env!(:app, :mail_reply_to_name)} <#{Application.fetch_env!(:app, :mail_reply_to_address)}>",
      "subject" => "[All Things Web Hackathon App] #{subject}",
      "textBody" => """
      Hi #{recipient_email} -

      #{text}

      All Things Web
      #{AppWeb.Endpoint.url()}
      """,
      "htmlBody" => """
      <p>Hi #{recipient_email} -</p>

      #{html}

      <p>
      All Things Web<br>
      <a href="#{AppWeb.Endpoint.url()}">All Things Web Hackathon App</a>
      </p>
      """
    }
  end

  defp send_email(claims) do
    if Application.fetch_env!(:app, :env) == :test do
      :ok
    else
      token = Jwt.generate_and_sign!(claims)

      case Req.post!("#{Application.fetch_env!(:app, :js_backend_url)}/microservices/mailer/send",
             json: %{jwt: token}
           ).body do
        "Success: Email sent." -> :ok
        body -> {:error, "Failed to send email: #{body}"}
      end
    end
  end

  # Update Email Instructions Email ________________________________________________________________

  def send_update_email_instructions(%User{} = user, url) do
    %{
      "job_name" => @update_email_instructions,
      "recipient_email" => user.email,
      "url" => url
    }
    |> App.Workers.Mailer.new(tags: [@update_email_instructions])
    |> Oban.insert()
  end

  defp update_email_instructions_text(url) do
    """
    You can change your email by visiting the URL below:

    #{url}

    If you didn't request this change, you can safely ignore this email.
    """
  end

  defp update_email_instructions_html(url) do
    """
    <p>You can change your email by visiting the URL below:</p>

    <p>#{url}</p>

    <p>If you didn't request this change, you can safely ignore this email.</p>
    """
  end

  # Magic Link Instructions Email __________________________________________________________________

  def send_magic_link_instructions(%User{} = user, url) do
    %{
      "job_name" => @magic_link_instructions,
      "recipient_email" => user.email,
      "url" => url
    }
    |> App.Workers.Mailer.new(tags: [@magic_link_instructions])
    |> Oban.insert()
  end

  defp magic_link_instructions_text(url) do
    """
    You can log into your account by visiting the URL below:

    #{url}

    If you didn't request this email, you can safely ignore this email.
    """
  end

  defp magic_link_instructions_html(url) do
    """
    <p>You can log into your account by visiting the URL below:</p>

    <p>#{url}</p>

    <p>If you didn't request this email, you can safely ignore this email.</p>
    """
  end

  # Confirmation Instructions Email ________________________________________________________________

  def send_confirmation_instructions(%User{} = user, url) do
    %{
      "job_name" => @confirmation_instructions,
      "recipient_email" => user.email,
      "url" => url
    }
    |> App.Workers.Mailer.new(tags: [@confirmation_instructions])
    |> Oban.insert()
  end

  defp confirmation_instructions_text(url) do
    """
    You can confirm your account by visiting the URL below:

    #{url}

    If you didn't create an account, you can safely ignore this email.
    """
  end

  defp confirmation_instructions_html(url) do
    """
    <p>You can confirm your account by visiting the URL below:</p>

    <p>#{url}</p>

    <p>If you didn't create an account, you can safely ignore this email.</p>
    """
  end
end
