defmodule AppWeb.MeController do
  use AppWeb, :controller

  def me(conn, _params) do
    if conn.assigns.current_scope do
      user = conn.assigns.current_scope.user
      token = Phoenix.Token.sign(conn, "user socket", user.id)
      json(conn, %{id: user.id, email: user.email, token: token})
    else
      conn
      |> put_status(:unauthorized)
      |> json(%{message: "Not logged in"})
    end
  end
end
