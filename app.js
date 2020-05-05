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

const clearVotes = (roomId) => {
  for (var user in gameStates[roomId].userData) {
    gameStates[roomId].userData[user].vote = [];
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
        roles: [],
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
      gameStates[data.room].status = "mafiaAction";
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
            gameStates[data.room].status = "detectiveAction";
            console.log(gameStates[data.room]);
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
            gameStates[data.room].status = "doctorAction";
            gameStates[data.room].results.investigated = user;
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
            gameStates[data.room].status = "dayPhase";
            gameStates[data.room].results.saved = user;
            clearVotes(data.room);
            console.log(`${gameStates[data.room].results.killed} was killed`);
            console.log(
              `${gameStates[data.room].results.investigated} was investigated`
            );
            console.log(`${gameStates[data.room].results.saved} was saved`);
          }
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
