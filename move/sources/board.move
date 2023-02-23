module deploy_account::boardgame {
    use std::vector;

    /// Index is out of bounds of the board
    const EOUT_OF_BOUNDS: u64 = 5;

    /// A representation of a board, by an individual vector of spaces.
    ///
    /// This is not represented as nested vectors to allow flexibility in
    /// how these spaces are represented, while mainting minimal overhead.
    ///
    /// The board is of a fixed size of spaces
    struct Board<T: drop + copy + store> has store, drop {
        spaces:vector<T>
    }

    /// Constructs a game board
    public fun new<T: drop + copy + store>(spaces: vector<T>): Board<T>  {
        Board {
            spaces
        }
    }

    /// Retrieves a space given by an index.
    ///
    /// This allows for varying adjacency schemes of squares on the board.
    public fun get_space<T: drop + copy + store>(board: &Board<T>, index: u64): T {
        assert!(index < vector::length(&board.spaces), EOUT_OF_BOUNDS);
        *vector::borrow(&board.spaces, index)
    }

    /// Retrieves the whole board, for viewing
    ///
    /// This requires duplicating the entire board, it should only be done for view functions
    public fun get_board<T: drop + copy + store>(board: &Board<T>): vector<T> {
        let index = 0;
        let length = vector::length(&board.spaces);
        let duplicate = vector::empty<T>();
        while (index < length) {
            vector::push_back(&mut duplicate,get_space(board, index));
            index = index + 1;
        };

        duplicate
    }

    /// Sets a specific space given by an index to the new value.
    public fun set_space<T: drop + copy + store>(board: &mut Board<T>, index: u64, new_value: T) {
        // Must be within bounds of the fixed size board
        assert!(index < vector::length(&board.spaces), EOUT_OF_BOUNDS);
        let square = vector::borrow_mut(&mut board.spaces, index);
        *square = new_value;
    }
}
