import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ message: "PDF fiscal pendiente de provider país." }, { status: 501 });
}
