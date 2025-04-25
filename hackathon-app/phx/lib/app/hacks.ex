defmodule App.Hacks do
  @moduledoc """
  The Hacks context.
  """

  import Ecto.Query, warn: false
  alias App.Repo

  alias App.Hacks.Hack
  alias App.Accounts.Scope

  @doc """
  Subscribes to scoped notifications about any hack changes.

  The broadcasted messages match the pattern:

    * {:created, %Hack{}}
    * {:updated, %Hack{}}
    * {:deleted, %Hack{}}

  """
  def subscribe_hacks(%Scope{} = scope) do
    key = scope.user.id

    Phoenix.PubSub.subscribe(App.PubSub, "user:#{key}:hacks")
  end

  defp broadcast(%Scope{} = scope, message) do
    key = scope.user.id

    Phoenix.PubSub.broadcast(App.PubSub, "user:#{key}:hacks", message)
  end

  @doc """
  Returns the list of hacks.

  ## Examples

      iex> list_hacks(scope)
      [%Hack{}, ...]

  """
  def list_hacks(%Scope{} = scope) do
    Repo.all(from hack in Hack, where: hack.user_id == ^scope.user.id)
  end

  @doc """
  Gets a single hack.

  Raises `Ecto.NoResultsError` if the Hack does not exist.

  ## Examples

      iex> get_hack!(123)
      %Hack{}

      iex> get_hack!(456)
      ** (Ecto.NoResultsError)

  """
  def get_hack!(%Scope{} = scope, id) do
    Repo.get_by!(Hack, id: id, user_id: scope.user.id)
  end

  @doc """
  Creates a hack.

  ## Examples

      iex> create_hack(%{field: value})
      {:ok, %Hack{}}

      iex> create_hack(%{field: bad_value})
      {:error, %Ecto.Changeset{}}

  """
  def create_hack(%Scope{} = scope, attrs) do
    with {:ok, hack = %Hack{}} <-
           %Hack{}
           |> Hack.changeset(attrs, scope)
           |> Repo.insert() do
      broadcast(scope, {:created, hack})
      {:ok, hack}
    end
  end

  @doc """
  Updates a hack.

  ## Examples

      iex> update_hack(hack, %{field: new_value})
      {:ok, %Hack{}}

      iex> update_hack(hack, %{field: bad_value})
      {:error, %Ecto.Changeset{}}

  """
  def update_hack(%Scope{} = scope, %Hack{} = hack, attrs) do
    true = hack.user_id == scope.user.id

    with {:ok, hack = %Hack{}} <-
           hack
           |> Hack.changeset(attrs, scope)
           |> Repo.update() do
      broadcast(scope, {:updated, hack})
      {:ok, hack}
    end
  end

  @doc """
  Deletes a hack.

  ## Examples

      iex> delete_hack(hack)
      {:ok, %Hack{}}

      iex> delete_hack(hack)
      {:error, %Ecto.Changeset{}}

  """
  def delete_hack(%Scope{} = scope, %Hack{} = hack) do
    true = hack.user_id == scope.user.id

    with {:ok, hack = %Hack{}} <-
           Repo.delete(hack) do
      broadcast(scope, {:deleted, hack})
      {:ok, hack}
    end
  end

  @doc """
  Returns an `%Ecto.Changeset{}` for tracking hack changes.

  ## Examples

      iex> change_hack(hack)
      %Ecto.Changeset{data: %Hack{}}

  """
  def change_hack(%Scope{} = scope, %Hack{} = hack, attrs \\ %{}) do
    true = hack.user_id == scope.user.id

    Hack.changeset(hack, attrs, scope)
  end
end
