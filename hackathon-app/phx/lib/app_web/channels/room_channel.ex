defmodule AppWeb.RoomChannel do
  @moduledoc """
  Room channel.
  """

  use Phoenix.Channel

  import Ecto.Query
  alias App.Repo

  alias App.Hacks.Category
  alias App.Hacks.Hack
  alias App.Hacks.Vote

  @impl true
  def join("room:public", _message, socket) do
    hacks = get_hacks()
    categories = get_categories_with_hacks()
    countdown = App.Services.Countdown.get_state()

    {:ok, %{hacks: hacks, categories: categories, countdown: countdown}, socket}
  end

  def join("room:" <> user_id, _message, socket) do
    if socket.assigns.current_user_id == user_id do
      user_votes = get_user_votes(socket)
      {:ok, %{user_votes: user_votes}, socket}
    else
      {:error, %{reason: "unauthorized"}}
    end
  end

  @impl true
  def handle_in("vote", %{"category_id" => category_id, "hack_id" => hack_id}, socket) do
    countdown = App.Services.Countdown.get_state()

    if countdown.running do
      handle_vote(socket, category_id, hack_id)
    else
      App.Services.Countdown.stop()
    end

    {:noreply, socket}
  end

  def handle_in("start_countdown", _message, socket) do
    if socket.assigns.current_user_id in admin_ids() do
      App.Services.Countdown.start()
    end

    {:noreply, socket}
  end

  def handle_in("stop_countdown", _message, socket) do
    if socket.assigns.current_user_id in admin_ids() do
      App.Services.Countdown.stop()
    end

    {:noreply, socket}
  end

  # TODO: Don't hardcode this 😅
  defp admin_ids() do
    [
      "2dc85741-ec60-41bc-a493-3db1f8d48914",
      "8623b244-9ee6-471f-b238-0ece985689c9"
    ]
  end

  # TODO: Move below to context module _____________________________________________________________

  defp categories() do
    Repo.all(from c in Category, select: %{id: c.id, name: c.name})
  end

  defp get_hacks() do
    Repo.all(from h in Hack, select: %{id: h.id, name: h.name, description: h.description})
    |> Enum.map(fn hack ->
      %{
        id: hack.id,
        name: hack.name,
        description: hack.description,
        categories:
          Enum.map(categories(), fn category ->
            %{
              id: category.id,
              name: category.name,
              votes:
                Repo.one(
                  from v in Vote,
                    where: v.category_id == ^category.id and v.hack_id == ^hack.id,
                    select: count()
                )
            }
          end)
      }
    end)
  end

  defp hacks_with_votes_for_category(category_id) do
    Repo.all(Hack)
    |> Enum.map(fn hack ->
      %{
        id: hack.id,
        name: hack.name,
        description: hack.description,
        votes:
          Repo.one(
            from v in Vote,
              where: v.category_id == ^category_id and v.hack_id == ^hack.id,
              select: count()
          )
      }
    end)
  end

  defp get_categories_with_hacks() do
    Enum.map(categories(), fn category ->
      hacks = hacks_with_votes_for_category(category.id)
      sorted_votes = hacks |> Enum.map(& &1.votes) |> MapSet.new() |> Enum.sort(&(&1 >= &2))

      hacks_with_rank =
        Enum.map(hacks, fn hack ->
          %{
            id: hack.id,
            name: hack.name,
            description: hack.description,
            votes: hack.votes,
            rank: Enum.find_index(sorted_votes, &(&1 == hack.votes)) + 1
          }
        end)
        |> Enum.sort_by(& &1.rank, &(&1 <= &2))

      %{id: category.id, name: category.name, hacks: hacks_with_rank}
    end)
  end

  defp get_user_votes(socket) do
    current_user_id = socket.assigns.current_user_id

    if current_user_id do
      Repo.all(
        from v in Vote,
          where: v.user_id == ^current_user_id,
          select: %{
            category_id: v.category_id,
            hack_id: v.hack_id
          }
      )
    else
      []
    end
  end

  def handle_vote(socket, category_id, hack_id) do
    current_user_id = socket.assigns.current_user_id

    vote =
      Repo.get_by(Vote,
        user_id: current_user_id,
        category_id: category_id,
        hack_id: hack_id
      )

    if vote do
      Repo.delete!(vote)
    else
      Repo.delete_all(
        from v in Vote,
          where: v.user_id == ^current_user_id and v.category_id == ^category_id
      )

      %Vote{user_id: current_user_id, category_id: category_id, hack_id: hack_id}
      |> Repo.insert!()
    end

    hacks = get_hacks()
    categories = get_categories_with_hacks()
    user_votes = get_user_votes(socket)

    AppWeb.Endpoint.broadcast!("room:public", "hacks", %{hacks: hacks})
    AppWeb.Endpoint.broadcast!("room:public", "categories", %{categories: categories})

    AppWeb.Endpoint.broadcast!("room:#{current_user_id}", "user_votes", %{
      user_votes: user_votes
    })
  end
end
