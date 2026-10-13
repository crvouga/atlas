// The todo list as the app keeps it. `example:run` executes the runs below with `quint test`.
// `quint test` selects definitions whose names end in Test.
// Every action assigns every variable: Quint's `any` needs one update set, and unchanged variables stay put.
module todo {
  type PHASE = Welcome | Naming | Working
  type SYNC = Synced | Offline
  type ITEM = { title: str, done: bool }

  pure val DEFAULT_NAME = "My todos"
  pure val WEEKEND = "Weekend chores"
  pure val PLANTS = "Water the plants"
  pure val COFFEE = "Buy coffee"
  pure val no_items: List[ITEM] = []

  var phase: PHASE
  var name_draft: str
  var list_name: str
  var items: List[ITEM]
  var sync: SYNC

  pure def open_items(list: List[ITEM]): List[ITEM] = list.select(i => not(i.done))
  pure def has_open(list: List[ITEM], title: str): bool = open_items(list).select(i => i.title == title).length() > 0
  pure def mark_done(list: List[ITEM]): List[ITEM] = list.foldl(no_items, (acc, i) => acc.append({ title: i.title, done: true }))

  val nothing_to_do = and(phase == Working, items.length() == 0)
  val some_open = open_items(items).length() > 0
  val all_done = and(items.length() > 0, not(some_open))
  val named_when_open = or(phase != Working, list_name != "")
  val offline_only_while_open = or(sync != Offline, phase == Working)
  val list_holds = and(named_when_open, offline_only_while_open)

  action init: bool = all {
    phase' = Welcome,
    name_draft' = "",
    list_name' = "",
    items' = no_items,
    sync' = Synced,
  }

  // Keep the state, so an assertion can run without taking a step.
  action hold: bool = all {
    phase' = phase,
    name_draft' = name_draft,
    list_name' = list_name,
    items' = items,
    sync' = sync,
  }

  action get_started: bool = all {
    phase == Welcome,
    phase' = Naming,
    name_draft' = name_draft,
    list_name' = list_name,
    items' = items,
    sync' = sync,
  }

  action type_name(name: str): bool = all {
    phase == Naming,
    phase' = phase,
    name_draft' = name,
    list_name' = list_name,
    items' = items,
    sync' = sync,
  }

  action create_list: bool = all {
    phase == Naming,
    name_draft != "",
    phase' = Working,
    name_draft' = name_draft,
    list_name' = name_draft,
    items' = no_items,
    sync' = Synced,
  }

  action skip_naming: bool = all {
    phase == Naming,
    phase' = Working,
    name_draft' = name_draft,
    list_name' = DEFAULT_NAME,
    items' = no_items,
    sync' = Synced,
  }

  action add(title: str): bool = all {
    phase == Working,
    title != "",
    phase' = phase,
    name_draft' = name_draft,
    list_name' = list_name,
    items' = items.append({ title: title, done: false }),
    sync' = sync,
  }

  action mark_all_done: bool = all {
    phase == Working,
    items.length() > 0,
    phase' = phase,
    name_draft' = name_draft,
    list_name' = list_name,
    items' = mark_done(items),
    sync' = sync,
  }

  action clear_completed: bool = all {
    phase == Working,
    phase' = phase,
    name_draft' = name_draft,
    list_name' = list_name,
    items' = open_items(items),
    sync' = sync,
  }

  action sync_fails: bool = all {
    phase == Working,
    sync == Synced,
    phase' = phase,
    name_draft' = name_draft,
    list_name' = list_name,
    items' = items,
    sync' = Offline,
  }

  action retry: bool = all {
    phase == Working,
    sync == Offline,
    phase' = phase,
    name_draft' = name_draft,
    list_name' = list_name,
    items' = items,
    sync' = Synced,
  }

  action start_over: bool = all {
    phase == Working,
    phase' = Welcome,
    name_draft' = "",
    list_name' = "",
    items' = no_items,
    sync' = Synced,
  }

  action step: bool = any {
    get_started,
    type_name(WEEKEND),
    create_list,
    skip_naming,
    add(PLANTS),
    add(COFFEE),
    mark_all_done,
    clear_completed,
    sync_fails,
    retry,
    start_over,
  }

  /// Name a list
  run name_a_listTest = init.then(get_started).then(type_name(WEEKEND)).then(create_list).then(all {
    assert(and(list_name == WEEKEND, nothing_to_do, sync == Synced, named_when_open, offline_only_while_open)),
    hold,
  })

  /// Create needs a name
  run create_needs_a_nameTest = init.then(get_started).then(create_list.fail())

  /// Skip naming
  run skip_namingTest = init.then(get_started).then(skip_naming).then(all {
    assert(and(list_name == DEFAULT_NAME, nothing_to_do, named_when_open)),
    hold,
  })

  /// Add a todo
  run add_a_todoTest = init.then(get_started).then(skip_naming).then(add(PLANTS)).then(all {
    assert(and(some_open, has_open(items, PLANTS), named_when_open)),
    hold,
  })

  /// Add several todos
  run add_severalTest = init.then(get_started).then(skip_naming).then(add(PLANTS)).then(add(COFFEE)).then(all {
    assert(and(has_open(items, PLANTS), has_open(items, COFFEE))),
    hold,
  })

  /// Finish every todo and clear them
  run finish_and_clearTest = init.then(get_started).then(skip_naming).then(add(PLANTS)).then(mark_all_done).then(all {
    assert(all_done),
    hold,
  }).then(clear_completed).then(all {
    assert(nothing_to_do),
    hold,
  })

  /// Keep working through an outage
  run offline_then_retryTest = init.then(get_started).then(type_name(WEEKEND)).then(create_list).then(add(PLANTS)).then(sync_fails).then(add(COFFEE)).then(all {
    assert(and(sync == Offline, has_open(items, COFFEE), offline_only_while_open)),
    hold,
  }).then(retry).then(all {
    assert(and(sync == Synced, has_open(items, COFFEE))),
    hold,
  })

  /// Throw the list away
  run start_overTest = init.then(get_started).then(skip_naming).then(add(PLANTS)).then(start_over).then(all {
    assert(and(phase == Welcome, sync == Synced)),
    hold,
  })

  /// Start over while offline
  run start_over_offlineTest = init.then(get_started).then(type_name(WEEKEND)).then(create_list).then(sync_fails).then(start_over).then(all {
    assert(and(phase == Welcome, sync == Synced, items.length() == 0)),
    hold,
  }).then(get_started).then(type_name(WEEKEND)).then(create_list).then(all {
    assert(and(list_name == WEEKEND, nothing_to_do, sync == Synced)),
    hold,
  })
}
