const SVG_NS = "http://www.w3.org/2000/svg";

const rooms = {
  gate: { label: "정문", subtitle: "출발 지점", x: 105, y: 235 },
  library: { label: "도서관", subtitle: "조용한 통로", x: 280, y: 105 },
  hall: { label: "중앙 복도", subtitle: "교차 지점", x: 455, y: 235 },
  lab: { label: "과학실", subtitle: "해독제", x: 645, y: 105, item: "해독제" },
  infirmary: { label: "보건실", subtitle: "응급 물품", x: 645, y: 365 },
  cafeteria: { label: "급식실", subtitle: "감염 지역", x: 455, y: 420 },
  gym: { label: "체육관", subtitle: "넓은 공간", x: 280, y: 365 },
  shelter: { label: "대피소", subtitle: "안전 목표", x: 105, y: 420, safe: true }
};

const edges = [
  ["gate", "library"], ["gate", "shelter"], ["library", "hall"], ["library", "gym"],
  ["hall", "lab"], ["hall", "cafeteria"], ["hall", "gym"], ["lab", "infirmary"],
  ["infirmary", "cafeteria"], ["cafeteria", "gym"], ["gym", "shelter"]
];

const state = {
  player: "gate",
  zombies: ["cafeteria"],
  barriers: new Set(),
  barrierTokens: 3,
  turn: 1,
  maxTurns: 8,
  distance: 0,
  hasAntidote: false,
  movedThisTurn: false,
  barrierPlacedThisTurn: false,
  barrierMode: false,
  result: null,
  log: []
};

const $ = (id) => document.getElementById(id);
const mapSvg = $("mapSvg");

function edgeKey(a, b) {
  return [a, b].sort().join("|");
}

function roomNeighbors(id, includeBlocked = false) {
  return edges.reduce((result, [a, b]) => {
    if (a !== id && b !== id) return result;
    const other = a === id ? b : a;
    if (includeBlocked || !state.barriers.has(edgeKey(id, other))) result.push(other);
    return result;
  }, []);
}

function connected(a, b) {
  return roomNeighbors(a).includes(b);
}

function addLog(message, type = "") {
  state.log.unshift({ message, type, turn: state.turn });
  state.log = state.log.slice(0, 10);
  $("logList").innerHTML = state.log.map((entry) => `<div class="log-entry ${entry.type}"><time>턴 ${entry.turn}</time><span>${entry.message}</span></div>`).join("");
}

function createSvgElement(tag, attributes = {}) {
  const element = document.createElementNS(SVG_NS, tag);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
  return element;
}

function renderMap() {
  mapSvg.querySelectorAll(".dynamic-mark").forEach((element) => element.remove());

  edges.forEach(([a, b]) => {
    const start = rooms[a];
    const end = rooms[b];
    const group = createSvgElement("g", { class: "dynamic-mark" });
    const line = createSvgElement("line", {
      x1: start.x, y1: start.y, x2: end.x, y2: end.y,
      class: `map-edge ${state.barriers.has(edgeKey(a, b)) ? "barrier" : ""}`,
      "data-edge": edgeKey(a, b),
      "aria-label": `${rooms[a].label}와 ${rooms[b].label} 사이 통로`
    });
    line.addEventListener("click", (event) => {
      event.stopPropagation();
      handleEdgeClick(a, b);
    });
    group.appendChild(line);
    if (state.barriers.has(edgeKey(a, b))) {
      const midpointX = (start.x + end.x) / 2;
      const midpointY = (start.y + end.y) / 2;
      const label = createSvgElement("text", { x: midpointX, y: midpointY - 8, class: "barrier-label" });
      label.textContent = "차단";
      group.appendChild(label);
    }
    mapSvg.appendChild(group);
  });

  Object.entries(rooms).forEach(([id, room]) => {
    const group = createSvgElement("g", { class: `dynamic-mark room ${id === state.player ? "player" : ""} ${state.zombies.includes(id) ? "zombie unsafe" : ""} ${room.safe ? "safe" : ""}`, tabindex: "0", role: "button", "aria-label": room.label });
    group.addEventListener("click", () => handleRoomClick(id));
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handleRoomClick(id);
      }
    });
    const rect = createSvgElement("rect", { x: room.x - 53, y: room.y - 26, width: 106, height: 52, rx: 12 });
    const label = createSvgElement("text", { x: room.x, y: room.y - 1, class: "room-label" });
    label.textContent = room.label;
    const subtitle = createSvgElement("text", { x: room.x, y: room.y + 16, class: "room-subtitle" });
    subtitle.textContent = room.subtitle;
    group.append(rect, label, subtitle);

    if (room.safe) {
      const safeLine = createSvgElement("rect", { x: room.x - 44, y: room.y - 17, width: 88, height: 34, rx: 8, class: "room-marker", stroke: "var(--green)" });
      group.insertBefore(safeLine, rect.nextSibling);
    }
    if (room.item && !state.hasAntidote) {
      const item = createSvgElement("circle", { cx: room.x + 39, cy: room.y - 15, r: 8, class: "item-marker" });
      const itemLabel = createSvgElement("text", { x: room.x + 39, y: room.y - 15, class: "marker-label" });
      itemLabel.textContent = "!";
      group.append(item, itemLabel);
    }
    if (id === state.player) {
      const ring = createSvgElement("circle", { cx: room.x, cy: room.y, r: 39, class: "player-ring" });
      const marker = createSvgElement("circle", { cx: room.x - 39, cy: room.y - 18, r: 11, class: "player-marker" });
      const markerLabel = createSvgElement("text", { x: room.x - 39, y: room.y - 18, class: "marker-label" });
      markerLabel.textContent = "나";
      group.append(ring, marker, markerLabel);
    }
    if (state.zombies.includes(id)) {
      const marker = createSvgElement("circle", { cx: room.x + 39, cy: room.y - 18, r: 11, class: "zombie-marker" });
      const markerLabel = createSvgElement("text", { x: room.x + 39, y: room.y - 18, class: "marker-label" });
      markerLabel.textContent = "Z";
      group.append(marker, markerLabel);
    }
    mapSvg.appendChild(group);
  });
}

function renderUi() {
  $("turnValue").textContent = Math.max(0, state.maxTurns - state.turn + 1);
  $("barrierValue").textContent = state.barrierTokens;
  $("distanceValue").textContent = state.distance;
  $("barrierMode").setAttribute("aria-pressed", String(state.barrierMode));
  $("barrierMode").textContent = state.barrierMode ? "설치할 통로를 선택하세요" : "바리케이드 설치 모드";
  $("endTurn").disabled = Boolean(state.result);
  $("barrierMode").disabled = state.barrierTokens === 0 || state.movedThisTurn || state.barrierPlacedThisTurn || Boolean(state.result);
  $("controlNote").textContent = state.movedThisTurn
    ? "이번 턴의 이동을 사용했습니다. 다음 턴에 좀비가 움직입니다."
    : state.barrierPlacedThisTurn
      ? "이번 턴의 바리케이드를 설치했습니다. 다음 턴에 좀비가 움직입니다."
      : "한 턴에 한 칸 이동하거나 통로를 차단할 수 있습니다. 차단은 다음 턴에도 유지됩니다.";

  const current = rooms[state.player];
  $("roomTitle").textContent = `현재 위치: ${current.label}`;
  $("roomCopy").textContent = state.zombies.includes(state.player)
    ? "위험합니다. 이 장소에는 좀비가 있습니다."
    : state.hasAntidote && state.player === "shelter"
      ? "대피소에 도착했습니다. 이제 안전합니다."
      : current.item && !state.hasAntidote
        ? "해독제가 있는 장소입니다. 클릭해서 확보하세요."
        : `${current.subtitle}입니다. 주변의 이동 경로를 살펴보세요.`;
  $("connectionCount").textContent = roomNeighbors(state.player).length;

  const dangerLevel = $("dangerLevel");
  const distanceToZombie = shortestDistanceToZombie(state.player);
  dangerLevel.className = "danger-level";
  if (distanceToZombie === 0) {
    dangerLevel.textContent = "위험";
    dangerLevel.classList.add("danger");
  } else if (distanceToZombie === 1) {
    dangerLevel.textContent = "주의";
    dangerLevel.classList.add("warn");
  } else {
    dangerLevel.textContent = "안전";
  }

  $("objectiveAntidote").classList.toggle("done", state.hasAntidote);
  $("objectiveAntidote").querySelector(".objective-mark").textContent = state.hasAntidote ? "✓" : "1";
  $("objectiveShelter").classList.toggle("done", state.hasAntidote && state.player === "shelter");
  $("objectiveShelter").querySelector(".objective-mark").textContent = state.hasAntidote && state.player === "shelter" ? "✓" : "2";

  if (state.result === "win") {
    $("missionStatus").textContent = "대피 성공";
    $("missionStatus").className = "mission-status";
  } else if (state.result === "lose") {
    $("missionStatus").textContent = "확산됨";
    $("missionStatus").className = "mission-status danger-level danger";
  } else {
    $("missionStatus").textContent = "진행 중";
    $("missionStatus").className = "mission-status";
  }
}

function shortestDistanceToZombie(start) {
  if (state.zombies.includes(start)) return 0;
  const queue = [[start, 0]];
  const visited = new Set([start]);
  while (queue.length) {
    const [current, distance] = queue.shift();
    if (state.zombies.includes(current)) return distance;
    roomNeighbors(current).forEach((next) => {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push([next, distance + 1]);
      }
    });
  }
  return Infinity;
}

function findNextStep(start, target) {
  const queue = [[start, [start]]];
  const visited = new Set([start]);
  while (queue.length) {
    const [current, path] = queue.shift();
    if (current === target) return path[1] || start;
    roomNeighbors(current).forEach((next) => {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push([next, [...path, next]]);
      }
    });
  }
  return start;
}

function handleRoomClick(id) {
  if (state.result) return;
  if (state.barrierMode) {
    setMapMessage("바리케이드를 설치하려면 통로를 클릭하세요.");
    return;
  }
  if (id === state.player) {
    setMapMessage(`${rooms[id].label}에 있습니다. 연결된 장소를 선택하세요.`);
    return;
  }
  if (state.movedThisTurn) {
    setMapMessage("이번 턴의 이동은 이미 사용했습니다. 다음 턴을 진행하세요.");
    return;
  }
  if (state.barrierPlacedThisTurn) {
    setMapMessage("이번 턴에는 이미 바리케이드를 설치했습니다. 다음 턴을 진행하세요.");
    return;
  }
  if (!connected(state.player, id)) {
    setMapMessage("바로 연결된 장소만 한 칸 이동할 수 있습니다.");
    return;
  }
  if (state.zombies.includes(id)) {
    loseGame("좀비가 있는 장소로 이동했습니다.");
    return;
  }
  const previous = state.player;
  state.player = id;
  state.movedThisTurn = true;
  state.distance += 1;
  if (id === "lab" && !state.hasAntidote) {
    state.hasAntidote = true;
    addLog("과학실에서 해독제를 확보했습니다.", "good");
    setMapMessage("해독제를 확보했습니다. 이제 대피소로 돌아가세요.");
  } else {
    addLog(`${rooms[previous].label}에서 ${rooms[id].label}(으)로 이동했습니다.`);
    setMapMessage(`${rooms[id].label}에 도착했습니다. 다음 행동을 선택하세요.`);
  }
  if (id === "shelter" && state.hasAntidote) winGame();
  renderAll();
}

function handleEdgeClick(a, b) {
  if (state.result) return;
  if (!state.barrierMode) {
    setMapMessage("바리케이드 설치 모드를 켠 뒤 통로를 클릭하세요.");
    return;
  }
  const key = edgeKey(a, b);
  if (state.barriers.has(key)) {
    setMapMessage("이미 차단된 통로입니다.");
    return;
  }
  if (state.barrierTokens <= 0) {
    setMapMessage("바리케이드를 모두 사용했습니다.");
    return;
  }
  if (state.movedThisTurn) {
    setMapMessage("이번 턴에는 이미 이동했습니다. 다음 턴에 바리케이드를 설치하세요.");
    return;
  }
  state.barriers.add(key);
  state.barrierTokens -= 1;
  state.barrierMode = false;
  state.barrierPlacedThisTurn = true;
  addLog(`${rooms[a].label}와 ${rooms[b].label} 사이 통로를 차단했습니다.`, "good");
  setMapMessage("통로를 차단했습니다. 다음 턴에 좀비의 이동을 막을 수 있습니다.");
  renderAll();
}

function endTurn() {
  if (state.result) return;
  state.barrierMode = false;
  if (state.player === "shelter" && state.hasAntidote) {
    winGame();
    return;
  }
  moveZombies();
  if (state.result) return;
  state.turn += 1;
  state.movedThisTurn = false;
  state.barrierPlacedThisTurn = false;
  if (state.turn > state.maxTurns) {
    loseGame("시간이 다 되어 대피소를 확보하지 못했습니다.");
    return;
  }
  addLog("새로운 턴이 시작되었습니다.");
  setMapMessage("좀비가 이동했습니다. 다음 경로를 선택하세요.");
  renderAll();
}

function moveZombies() {
  const moved = [];
  const occupied = new Set();
  state.zombies.forEach((zombie) => {
    const next = findNextStep(zombie, state.player);
    if (next === state.player) {
      loseGame("좀비가 현재 위치까지 따라왔습니다.");
      return;
    }
    if (!occupied.has(next)) {
      moved.push(next);
      occupied.add(next);
    } else {
      moved.push(zombie);
      occupied.add(zombie);
    }
  });
  if (!state.result) {
    state.zombies = moved;
    addLog("좀비가 연결된 통로를 따라 이동했습니다.", "alert");
    if (state.zombies.includes(state.player)) loseGame("좀비가 현재 위치까지 따라왔습니다.");
  }
}

function winGame() {
  if (state.result) return;
  state.result = "win";
  addLog("해독제를 들고 대피소에 도착했습니다. 대피 성공입니다.", "good");
  openResult("win");
  renderAll();
}

function loseGame(reason) {
  if (state.result) return;
  state.result = "lose";
  addLog(reason, "alert");
  openResult("lose");
  renderAll();
}

function openResult(result) {
  $("resultOverlay").hidden = false;
  if (result === "win") {
    $("resultTitle").textContent = "대피 성공";
    $("resultCopy").textContent = `${state.distance}칸을 이동하고 바리케이드 ${3 - state.barrierTokens}개를 사용했습니다. 학교의 연결을 잘 읽어냈습니다.`;
  } else {
    $("resultTitle").textContent = "확산을 막지 못했습니다";
    $("resultCopy").textContent = "좀비의 이동 경로를 다시 관찰하고, 다음에는 중요한 통로부터 차단해 보세요.";
  }
}

function setMapMessage(message) {
  $("mapMessage").textContent = message;
}

function resetGame() {
  state.player = "gate";
  state.zombies = ["cafeteria"];
  state.barriers = new Set();
  state.barrierTokens = 3;
  state.turn = 1;
  state.distance = 0;
  state.hasAntidote = false;
  state.movedThisTurn = false;
  state.barrierPlacedThisTurn = false;
  state.barrierMode = false;
  state.result = null;
  state.log = [];
  $("resultOverlay").hidden = true;
  setMapMessage("도서관으로 이동해 해독제 위치를 확인하세요.");
  addLog("좀비가 급식실에서 발견되었습니다. 서둘러 이동하세요.", "alert");
  renderAll();
}

function renderAll() {
  renderMap();
  renderUi();
}

$("barrierMode").addEventListener("click", () => {
  if (state.result || state.barrierTokens <= 0) return;
  state.barrierMode = !state.barrierMode;
  setMapMessage(state.barrierMode ? "차단할 통로를 클릭하세요." : "바리케이드 설치 모드를 종료했습니다.");
  renderAll();
});
$("endTurn").addEventListener("click", endTurn);
$("newGameTop").addEventListener("click", resetGame);
$("newGameResult").addEventListener("click", resetGame);

resetGame();
