const app = require("express")();
const http = require("http").createServer(app);

var io = require("socket.io")(http);

let clientList = [];
let gameStates = {};

// syncs all games connected to room
const syncGame = (roomId) => {
  let gameState = gameStates[roomId];
  io.in(roomId).emit("syncGame", gameState);
};

// asign roles to users to start game
const asignRoles = (roomId, roles) => {
  let rolesToAssign = [];
  for (let index = 0; index < roles.mafia; index++) {
    rolesToAssign.push("mafia");
  }
  for (let index = 0; index < roles.detective; index++) {
    rolesToAssign.push("detective");
  }
  for (let index = 0; index < roles.doctor; index++) {
    rolesToAssign.push("doctor");
  }
  for (let index = 0; index < roles.villager; index++) {
    rolesToAssign.push("villager");
  }

  // randomly assign roles
  for (var user in gameStates[roomId].userData) {
    let chosenRole = Math.floor(Math.random() * rolesToAssign.length);
    gameStates[roomId].userData[user].role = rolesToAssign.splice(
      chosenRole,
      1
    )[0];
  }
};

const nextAction = (roomId, toAction) => {
  gameStates[roomId].status = toAction;
  if (
    gameStates[roomId].status === "mafiaAction" &&
    gameStates[roomId].setup.mafia === 0
  ) {
    gameStates[roomId].status = "detectiveAction";
  }
  if (
    gameStates[roomId].status === "detectiveAction" &&
    gameStates[roomId].setup.detective === 0
  ) {
    gameStates[roomId].status = "doctorAction";
  }
  if (
    gameStates[roomId].status === "doctorAction" &&
    gameStates[roomId].setup.doctor === 0
  ) {
    gameStates[roomId].status = "dayPhase";
    setTimeout(() => {
      console.log("dayVote")
      nextAction(roomId, "dayVote");
      syncGame(roomId);
    }, 5000);
  }
};

const clearReady = (roomId) => {
  for (var user in gameStates[roomId].userData) {
    gameStates[roomId].userData[user].ready = false;
    gameStates[roomId].ready = 0;
  }
};

const clearVotes = (roomId) => {
  for (var user in gameStates[roomId].userData) {
    gameStates[roomId].userData[user].vote = [];
  }
};

const calculateResult = (roomId) => {
  if (gameStates[roomId].results.killed === gameStates[roomId].results.saved) {
    console.log(
      `[Room:${roomId}] ${gameStates[roomId].results.saved} was saved`
    );
  } else {
    console.log(
      `[Room:${roomId}] ${gameStates[roomId].results.killed} was killed`
    );
  }
};

// user connection
io.on("connection", (socket) => {
  clientList.push(socket.client.id);
  // console.log(
  //   `[global] User ${socket.client.id} connected (${clientList.length} connected)`
  // );

  // join game
  socket.on("joinGame", (data) => {
    if (!gameStates[data.room]) {
      gameStates[data.room] = {
        room: data.room,
        status: "lobby",
        admin: data.user,
        userData: {},
        users: [],
        setup: {},
        ready: [],
        vote: [],
        results: {
          killed: null,
          investigated: null,
          saved: null,
        },
      }; //initialise game
      console.log(`[Room:${data.room}] New game created by ${data.user}`);
    }
    if (gameStates[data.room].status === "lobby") {
      if (!gameStates[data.room].userData.hasOwnProperty(data.user)) {
        gameStates[data.room].userData[data.user] = {
          client: socket.client.id,
          name: data.user,
          role: null,
          ready: false,
          vote: [],
          dead: false,
        };
        socket.join(data.room);
        console.log(`[Room:${data.room}] User ${data.user} joined`);

        syncGame(data.room);
      } else {
        socket.emit("errorMsg", "Unable to join. User already exists.");
      }
    } else {
      socket.emit("errorMsg", "Unable to join. Game already in progress.");
    }
  });

  // host set-up and start game
  socket.on("startGame", (data) => {
    if (gameStates[data.room].admin === data.user) {
      gameStates[data.room].status = "roleAssign";
      gameStates[data.room].setup = data.roles;
      console.log(`[Room:${data.room}] Game started by ${data.user}`);

      asignRoles(data.room, data.roles);

      syncGame(data.room);
    }
  });

  // wait for players to recieve roles
  socket.on("playerReady", (data) => {
    gameStates[data.room].userData[data.user].ready = true;
    gameStates[data.room].ready++;
    if (
      Object.keys(gameStates[data.room].userData).length ===
      gameStates[data.room].ready
    ) {
      nextAction(data.room, "mafiaAction");
      clearReady(data.room);
    }

    syncGame(data.room);
  });

  // recieve vote from players
  socket.on("vote", (data) => {
    // record vote
    for (var user in gameStates[data.room].userData) {
      if (gameStates[data.room].userData[user].vote.includes(data.user)) {
        gameStates[data.room].userData[user].vote.splice(
          gameStates[data.room].userData[user].vote.indexOf(data.user),
          1
        );
      }
    }
    gameStates[data.room].userData[data.votedUser].vote.push(data.user);

    // check for unanimous vote
    switch (data.type) {
      case "mafia":
        for (var user in gameStates[data.room].userData) {
          if (
            gameStates[data.room].setup.mafia ===
            gameStates[data.room].userData[user].vote.length
          ) {
            nextAction(data.room, "mafiaKill");
            gameStates[data.room].results.killed = user;
            clearVotes(data.room);
          }
        }
        break;

      case "detective":
        for (var user in gameStates[data.room].userData) {
          if (
            gameStates[data.room].setup.detective ===
            gameStates[data.room].userData[user].vote.length
          ) {
            nextAction(data.room, "detectiveInvestigation");
            gameStates[data.room].results.investigated = user;
            console.log(
              `[Room:${data.room}] ${
                gameStates[data.room].results.investigated
              } was investigated`
            );
            clearVotes(data.room);
          }
        }
        break;

      case "doctor":
        for (var user in gameStates[data.room].userData) {
          if (
            gameStates[data.room].setup.doctor ===
            gameStates[data.room].userData[user].vote.length
          ) {
            nextAction(data.room, "doctorSave");
            gameStates[data.room].results.saved = user;
            clearVotes(data.room);
          }
        }
        break;
      case "lynch":
        for (var user in gameStates[data.room].userData) {
          if (
            Object.keys(gameStates[data.room].userData).length ===
            gameStates[data.room].userData[user].vote.length
          ) {
            // TO DO
            nextAction(data.room, "mafiaAction");
            clearVotes(data.room);
          }
        }
        break;
      default:
        break;
    }
    syncGame(data.room);
  });

  socket.on("confirmDecision", (data) => {
    gameStates[data.room].userData[data.user].ready = true;
    gameStates[data.room].ready++;
    switch (data.type) {
      case "mafia":
        if (gameStates[data.room].setup.mafia === gameStates[data.room].ready) {
          nextAction(data.room, "detectiveAction");
          clearReady(data.room);
        }
        break;
      case "detective":
        if (
          gameStates[data.room].setup.detective === gameStates[data.room].ready
        ) {
          nextAction(data.room, "doctorAction");
          clearReady(data.room);
        }
        break;
      case "doctor":
        if (
          gameStates[data.room].setup.doctor === gameStates[data.room].ready
        ) {
          nextAction(data.room, "dayPhase");
          clearReady(data.room);
          calculateResult(data.room);
          setTimeout(() => {
            nextAction(data.room, "dayVote");
            syncGame(data.room);
          }, 5000);
        }
        break;

      default:
        break;
    }

    syncGame(data.room);
  });

  // disconnect
  socket.on("disconnect", () => {
    clientList.splice(clientList.indexOf(socket.client.id), 1);
    console.log(
      `[global] User ${socket.client.id} disconnected (${clientList.length} connected)`
    );
  });
});

http.listen(5000, () => {
  console.log("[server] listening on *:5000");
});
