import { NextResponse } from "next/server";
import { describeDatabaseError } from "@/lib/database";

export async function handleApiOperation(
  operationName: string,
  operation: () => Promise<NextResponse>,
) {
  try {
    return await operation();
  } catch (error) {
    console.error(`CareerVault HR ${operationName} failed.`, error);

    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { ok: false, message: "The request body is not valid JSON." },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        ok: false,
        message: describeDatabaseError(error),
      },
      { status: 503 },
    );
  }
}
