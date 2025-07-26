import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { type Id } from "./_generated/dataModel";

export const getList = internalQuery({
  args: { listId: v.id("lists") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.listId);
  },
});

//
// FETCH ALL LISTS FOR A USER (Personal and Team)
//
export const getLists = query({
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Unauthorized");
    }

    // Get personal lists
    const personalLists = await ctx.db
      .query("lists")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("teamId"), undefined))
      .collect();

    // Get team lists
    const teamMemberships = await ctx.db
      .query("team_members")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const teamLists = (
      await Promise.all(
        teamMemberships.map(async (membership) => {
          return await ctx.db
            .query("lists")
            .withIndex("by_team", (q) => q.eq("teamId", membership.teamId))
            .collect();
        }),
      )
    ).flat();

    const allLists = [...personalLists, ...teamLists];

    const listsWithItems = await Promise.all(
      allLists.map(async (list) => {
        const items = await ctx.db
          .query("items")
          .withIndex("by_list", (q) => q.eq("listId", list._id))
          .collect();
        return { ...list, nodes: items };
      }),
    );

    return listsWithItems.sort((a, b) => a.name.localeCompare(b.name));
  },
});

// Helper function to check if a user has access to a list
export const hasAccessToList = async (
  ctx: QueryCtx | MutationCtx,
  userId: string,
  listId: Id<"lists">,
): Promise<boolean> => {
  const list = await ctx.db.get(listId);
  if (!list) return false;

  if (list.userId === userId) {
    return true;
  }

  if (list.teamId) {
    const membership = await ctx.db
      .query("team_members")
      .withIndex("by_team_user", (q) =>
        q.eq("teamId", list.teamId!).eq("userId", userId),
      )
      .first();
    return !!membership;
  }

  return false;
};

export const getItems = query({
  args: {
    listId: v.id("lists"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId || !(await hasAccessToList(ctx, userId, args.listId))) {
      throw new Error("Unauthorized");
    }
    const items = await ctx.db
      .query("items")
      .filter((q) => q.eq(q.field("listId"), args.listId))
      .collect();
    return items.map((item) => ({
      uuid: item._id,
      text: item.text,
      state: item.state,
    }));
  },
});

//
// CREATE A NEW LIST (Personal or for a Team)
//
export const createList = internalMutation({
  args: {
    name: v.string(),
    teamId: v.optional(v.id("teams")),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("lists", {
      name: args.name,
      userId: args.userId,
      teamId: args.teamId,
      order: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

export const createListPublic = mutation({
  args: { name: v.string(), teamId: v.optional(v.id("teams")) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Unauthorized");
    }

    if (args.teamId) {
      const membership = await ctx.db
        .query("team_members")
        .withIndex("by_team_user", (q) =>
          q.eq("teamId", args.teamId!).eq("userId", userId),
        )
        .first();
      if (!membership) {
        throw new Error("Unauthorized to create a list for this team");
      }
    }

    return await ctx.db.insert("lists", {
      name: args.name,
      userId,
      teamId: args.teamId,
      order: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

//
// RENAME A LIST
//
export const updateList = mutation({
  args: { id: v.id("lists"), name: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId || !(await hasAccessToList(ctx, userId, args.id))) {
      throw new Error("Unauthorized");
    }

    await ctx.db.patch(args.id, {
      name: args.name,
      updatedAt: Date.now(),
    });
  },
});

//
// DELETE A LIST + ITS ITEMS
//
export const deleteList = internalMutation({
  args: { id: v.id("lists") },
  handler: async (ctx, args) => {
    // remove items first
    const items = await ctx.db
      .query("items")
      .withIndex("by_list", (q) => q.eq("listId", args.id))
      .collect();
    for (const item of items) {
      await ctx.db.delete(item._id);
    }

    // then the list
    await ctx.db.delete(args.id);
  },
});

export const deleteListPublic = mutation({
  args: { id: v.id("lists") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Unauthorized");

    const list = await ctx.db.get(args.id);
    if (!list) throw new Error("List not found");

    // If it's a team list, check for admin role
    if (list.teamId) {
      const membership = await ctx.db
        .query("team_members")
        .withIndex("by_team_user", (q) =>
          q.eq("teamId", list.teamId!).eq("userId", userId),
        )
        .first();
      if (membership?.role !== "admin") {
        throw new Error("Only team admins can delete team lists.");
      }
    } else {
      // If it's a personal list, check if the user is the owner
      if (list.userId !== userId) {
        throw new Error("You can only delete your own lists.");
      }
    }

    // remove items first
    const items = await ctx.db
      .query("items")
      .withIndex("by_list", (q) => q.eq("listId", args.id))
      .collect();
    for (const item of items) {
      await ctx.db.delete(item._id);
    }

    // then the list
    await ctx.db.delete(args.id);
  },
});

//
// CRUD FOR ITEMS
//
export const createItem = internalMutation({
  args: {
    listId: v.id("lists"),
    text: v.string(),
    state: v.string(),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.insert("items", {
      listId: args.listId,
      text: args.text,
      state: args.state,
      userId: "internal", // or some other indicator
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return item;
  },
});

export const createItemPublic = mutation({
  args: {
    listId: v.id("lists"),
    text: v.string(),
    state: v.string(),
    startDate: v.optional(v.number()),
    dueDate: v.optional(v.number()),
    assigneeId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId || !(await hasAccessToList(ctx, userId, args.listId))) {
      throw new Error("Unauthorized");
    }

    return await ctx.db.insert("items", {
      listId: args.listId,
      text: args.text,
      state: args.state,
      userId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      startDate: args.startDate,
      dueDate: args.dueDate,
      assigneeId: args.assigneeId,
    });
  },
});

export const updateItem = mutation({
  args: {
    id: v.id("items"),
    text: v.optional(v.string()),
    state: v.optional(v.string()),
    startDate: v.optional(v.number()),
    dueDate: v.optional(v.number()),
    assigneeId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Unauthorized");
    }
    const item = await ctx.db.get(args.id);
    if (!item || !(await hasAccessToList(ctx, userId, item.listId))) {
      throw new Error("Unauthorized");
    }

    // If assignee is changing, create a notification
    if (args.assigneeId && args.assigneeId !== item.assigneeId) {
      await ctx.db.insert("notifications", {
        recipientId: args.assigneeId,
        actorId: userId,
        type: "assignment",
        itemId: item._id,
        read: false,
      });
    }

    const { id, ...rest } = args;
    await ctx.db.patch(id, {
      ...rest,
      updatedAt: Date.now(),
    });
  },
});

export const deleteItem = internalMutation({
  args: { id: v.id("items") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});

export const deleteItemPublic = mutation({
  args: { id: v.id("items") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Unauthorized");
    }
    const item = await ctx.db.get(args.id);
    if (!item || !(await hasAccessToList(ctx, userId, item.listId))) {
      throw new Error("Unauthorized");
    }
    await ctx.db.delete(args.id);
  },
});
