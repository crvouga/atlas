// A list owns its todos.
sig List { todos: set Todo }
sig Todo {}
fact { all t: Todo | one t.~todos }
