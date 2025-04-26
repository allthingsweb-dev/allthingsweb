defmodule AppWeb.SpaController do
  use AppWeb, :controller

  def spa(conn, _params) do
    conn
    |> put_resp_content_type("text/html")
    |> send_file(200, Path.join(:code.priv_dir(:app), "static/_index.html"))
  end
end
