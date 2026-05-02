"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfirmationSchema = exports.AdminResolveReportSchema = exports.ReportSchema = exports.AddItemSchema = exports.CreateRoomSchema = void 0;
const zod_1 = require("zod");
exports.CreateRoomSchema = zod_1.z.object({
    title: zod_1.z.string().min(3).max(100),
});
exports.AddItemSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).max(200),
    float_value: zod_1.z.number().min(0).max(1).optional(),
    wear: zod_1.z.string().optional(),
    rarity: zod_1.z.string().optional(),
    image_url: zod_1.z.string().url().optional(),
    price_usd: zod_1.z.number().min(0).optional(),
});
exports.ReportSchema = zod_1.z.object({
    reason: zod_1.z.string().min(10).max(1000),
});
exports.AdminResolveReportSchema = zod_1.z.object({
    status: zod_1.z.enum(['resolved', 'dismissed']),
});
// Reconciled from architecture.md: 4-checkbox confirmation per user
exports.ConfirmationSchema = zod_1.z.object({
    confirmed_profile: zod_1.z.boolean().optional(),
    confirmed_items: zod_1.z.boolean().optional(),
    confirmed_code: zod_1.z.boolean().optional(),
    confirmed_mobile: zod_1.z.boolean().optional(),
});
