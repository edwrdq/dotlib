import { httpRouter } from "convex/server";
import { getAuthSessionId, getAuthUserId } from "@convex-dev/auth/server";
import { auth } from "./auth";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";
import { type Id } from "./_generated/dataModel";
import "./lists";
import "./teams";
import "./main"; // Import the new consolidated file

const http = httpRouter();
auth.addHttpRoutes(http);

const requireDevApiKey = (handler: (ctx: any, request: Request) => Promise<Response>) => {
  return httpAction(async (ctx, request) => {
    const apiKey = request.headers.get("X-API-KEY");
    if (apiKey !== process.env.DEV_API_KEY) {
      return new Response("Invalid API Key", { status: 401 });
    }
    return handler(ctx, request);
  });
};

const requireJWT = (handler: (ctx: any, request: Request) => Promise<Response>) => {
  return httpAction(async (ctx, request) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return new Response("Unauthorized", { status: 403 })
    }
    return handler(ctx, request);
  });
};

http.route({
  path: "/health",
  method: "GET",
  handler: httpAction(async () => {
    return new Response("OK", { status: 200 });
  }),
});

http.route({
  path: "/users",
  method: "GET",
  handler: requireDevApiKey(async (ctx) => {
    const userCount = await ctx.runQuery(api.main.getUserCount);
    return new Response(JSON.stringify({ totalUsers: userCount }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

http.route({
  path: "/api/user",
  method: "GET",
  handler: requireJWT(async (ctx, request) => {
    const user = await ctx.runQuery(api.main.getMyUserProfile);

    if (!user) {
      return new Response("User not found", { status: 404 });
    }

    const sanitized = {
      username: user.username,
      userId: user.userId,
    };

    return new Response(JSON.stringify(sanitized), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

http.route({
  path: "/api/user/notifications",
  method: "GET",
  handler: requireJWT(async (ctx, request) => {
    const notifications = await ctx.runQuery(api.notifications.getNotifications);

    return new Response(JSON.stringify(notifications), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

http.route({
  path: "/api/teams",
  method: "GET",
  handler: requireJWT(async (ctx, request) => {
    const teams = await ctx.runQuery(api.teams.getTeams);

    return new Response(JSON.stringify(teams), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

http.route({
  path: "/api/teams",
  method: "POST",
  handler: requireJWT(async (ctx, request) => {
    const { teamName } = await request.json();

    if (typeof teamName !== "string") {
      return new Response("Invalid request body", { status: 400 });
    }
    const team = await ctx.runMutation(api.teams.createTeam, {
      name: teamName
    });

    return new Response(JSON.stringify(team), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

http.route({
  pathPrefix: "/api/teams/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const [teamId, ...subpath] = new URL(request.url).pathname.slice("/api/teams/".length).split("/");

    if (!teamId || (subpath[0] !== "lists" && subpath[0] !== "members")) {
      return new Response("Not Found", { status: 404 });
    }

    if (subpath[0] === "lists") {
      /*
      const lists = await ctx.runQuery(api.teams.getLists);
      return new Response(JSON.stringify(lists), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
      */
      return new Response("Not Found", { status: 404 });
    }

    if (subpath[0] === "members") {
      const lists = await ctx.runQuery(api.teams.getTeamMembers, {
        teamId: teamId as Id<"teams">
      });
      return new Response(JSON.stringify(lists), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Internal Server Error", { status: 500 });
  }),
});

http.route({
  path: "/lists",
  method: "GET",
  handler: requireJWT(async (ctx, request) => {
    const { searchParams } = new URL(request.url);

    const lists = await ctx.runQuery(api.lists.getLists);

    return new Response(JSON.stringify(lists), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

http.route({
  pathPrefix: "/lists/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const path = url.pathname;
    const rest = path.slice("/lists/".length);
    const [listId, ...subpath] = rest.split("/");

    if (!listId || subpath[0] !== "items") {
      return new Response("Not Found", { status: 404 });
    }

    const { searchParams } = new URL(request.url);

    if (!listId) {
      return new Response("Missing `listId` parameter", { status: 400 });
    }

    const items = await ctx.runQuery(api.lists.getItems, {
      listId: listId as Id<"lists">,
    });

    if (!items) {
      return new Response("List not found", { status: 404 });
    }

    return new Response(JSON.stringify(items), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

export default http;