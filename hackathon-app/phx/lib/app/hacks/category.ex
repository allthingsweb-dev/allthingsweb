defmodule App.Hacks.Category do
  @moduledoc """
  Category schema.
  """

  use App.Schema

  schema "categories" do
    field :name, :string

    timestamps()
  end
end
