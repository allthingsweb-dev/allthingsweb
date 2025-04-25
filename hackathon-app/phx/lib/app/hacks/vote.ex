defmodule App.Hacks.Vote do
  @moduledoc """
  Vote schema.
  """

  use App.Schema

  alias App.Accounts.User
  alias App.Hacks.Category
  alias App.Hacks.Hack

  schema "votes" do
    belongs_to :user, User
    belongs_to :category, Category
    belongs_to :hack, Hack

    timestamps()
  end
end
