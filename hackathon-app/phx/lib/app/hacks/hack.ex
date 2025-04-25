defmodule App.Hacks.Hack do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id
  schema "hacks" do
    field :name, :string
    field :description, :string
    field :votes, :integer
    field :user_id, :binary_id

    timestamps(type: :utc_datetime)
  end

  @doc false
  def changeset(hack, attrs, user_scope) do
    hack
    |> cast(attrs, [:name, :description, :votes])
    |> validate_required([:name, :description, :votes])
    |> put_change(:user_id, user_scope.user.id)
  end
end
