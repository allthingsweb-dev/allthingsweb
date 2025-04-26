defmodule App.HacksTest do
  use App.DataCase

  alias App.Hacks

  describe "hacks" do
    alias App.Hacks.Hack

    import App.AccountsFixtures, only: [user_scope_fixture: 0]
    import App.HacksFixtures

    @invalid_attrs %{name: nil, description: nil, votes: nil}

    test "list_hacks/1 returns all scoped hacks" do
      scope = user_scope_fixture()
      other_scope = user_scope_fixture()
      hack = hack_fixture(scope)
      other_hack = hack_fixture(other_scope)
      assert Hacks.list_hacks(scope) == [hack]
      assert Hacks.list_hacks(other_scope) == [other_hack]
    end

    test "get_hack!/2 returns the hack with given id" do
      scope = user_scope_fixture()
      hack = hack_fixture(scope)
      other_scope = user_scope_fixture()
      assert Hacks.get_hack!(scope, hack.id) == hack
      assert_raise Ecto.NoResultsError, fn -> Hacks.get_hack!(other_scope, hack.id) end
    end

    test "create_hack/2 with valid data creates a hack" do
      valid_attrs = %{name: "some name", description: "some description", votes: 42}
      scope = user_scope_fixture()

      assert {:ok, %Hack{} = hack} = Hacks.create_hack(scope, valid_attrs)
      assert hack.name == "some name"
      assert hack.description == "some description"
      assert hack.votes == 42
      assert hack.user_id == scope.user.id
    end

    test "create_hack/2 with invalid data returns error changeset" do
      scope = user_scope_fixture()
      assert {:error, %Ecto.Changeset{}} = Hacks.create_hack(scope, @invalid_attrs)
    end

    test "update_hack/3 with valid data updates the hack" do
      scope = user_scope_fixture()
      hack = hack_fixture(scope)

      update_attrs = %{
        name: "some updated name",
        description: "some updated description",
        votes: 43
      }

      assert {:ok, %Hack{} = hack} = Hacks.update_hack(scope, hack, update_attrs)
      assert hack.name == "some updated name"
      assert hack.description == "some updated description"
      assert hack.votes == 43
    end

    test "update_hack/3 with invalid scope raises" do
      scope = user_scope_fixture()
      other_scope = user_scope_fixture()
      hack = hack_fixture(scope)

      assert_raise MatchError, fn ->
        Hacks.update_hack(other_scope, hack, %{})
      end
    end

    test "update_hack/3 with invalid data returns error changeset" do
      scope = user_scope_fixture()
      hack = hack_fixture(scope)
      assert {:error, %Ecto.Changeset{}} = Hacks.update_hack(scope, hack, @invalid_attrs)
      assert hack == Hacks.get_hack!(scope, hack.id)
    end

    test "delete_hack/2 deletes the hack" do
      scope = user_scope_fixture()
      hack = hack_fixture(scope)
      assert {:ok, %Hack{}} = Hacks.delete_hack(scope, hack)
      assert_raise Ecto.NoResultsError, fn -> Hacks.get_hack!(scope, hack.id) end
    end

    test "delete_hack/2 with invalid scope raises" do
      scope = user_scope_fixture()
      other_scope = user_scope_fixture()
      hack = hack_fixture(scope)
      assert_raise MatchError, fn -> Hacks.delete_hack(other_scope, hack) end
    end

    test "change_hack/2 returns a hack changeset" do
      scope = user_scope_fixture()
      hack = hack_fixture(scope)
      assert %Ecto.Changeset{} = Hacks.change_hack(scope, hack)
    end
  end
end
