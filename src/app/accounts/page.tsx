"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatZarCurrency } from "@/lib/utils";

type AccountAdminDto = {
  id: number;
  name: string;
  contactEmail?: string;
  active: boolean;
};

type AccountBalanceDto = {
  totalCharged: number;
  totalReversed: number;
  totalPaid: number;
  outstandingBalance: number;
};

function parseError(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    if (typeof record.message === "string" && record.message.trim()) return record.message;
    if (typeof record.error === "string" && record.error.trim()) return record.error;
  }
  return fallback;
}

export default function AccountsPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading, user, authFetch } = useAuth();

  const [accounts, setAccounts] = useState<AccountAdminDto[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [balance, setBalance] = useState<AccountBalanceDto | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<AccountAdminDto | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [activeInput, setActiveInput] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentSaving, setPaymentSaving] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      router.replace("/login");
      return;
    }
    if (!user?.role?.toUpperCase().includes("ADMIN")) {
      router.replace("/dashboard");
    }
  }, [authLoading, isAuthenticated, router, user]);

  const loadAccounts = useCallback(async () => {
    setAccountsLoading(true);
    setAccountsError(null);
    try {
      const res = await authFetch("/admin/accounts");
      const body = (await res.json().catch(() => null)) as AccountAdminDto[] | unknown;
      if (!res.ok || !Array.isArray(body)) {
        throw new Error(parseError(body, "Unable to load accounts."));
      }
      setAccounts(body);
      setSelectedAccountId((current) => {
        if (current && body.some((account) => account.id === current)) return current;
        return body.length > 0 ? body[0].id : null;
      });
    } catch (err) {
      setAccountsError(err instanceof Error ? err.message : "Unable to load accounts.");
      setAccounts([]);
      setSelectedAccountId(null);
    } finally {
      setAccountsLoading(false);
    }
  }, [authFetch]);

  const loadBalance = useCallback(
    async (accountId: number) => {
      setBalanceLoading(true);
      setBalanceError(null);
      try {
        const res = await authFetch(`/admin/accounts/${accountId}/balance`);
        const body = (await res.json().catch(() => null)) as AccountBalanceDto | unknown;
        if (!res.ok || !body) {
          throw new Error(parseError(body, "Unable to load account balance."));
        }
        setBalance(body as AccountBalanceDto);
      } catch (err) {
        setBalanceError(err instanceof Error ? err.message : "Unable to load account balance.");
        setBalance(null);
      } finally {
        setBalanceLoading(false);
      }
    },
    [authFetch],
  );

  useEffect(() => {
    if (isAuthenticated && user?.role?.toUpperCase().includes("ADMIN")) {
      void loadAccounts();
    }
  }, [isAuthenticated, loadAccounts, user]);

  useEffect(() => {
    if (!selectedAccountId) {
      setBalance(null);
      return;
    }
    void loadBalance(selectedAccountId);
  }, [loadBalance, selectedAccountId]);

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === selectedAccountId) ?? null,
    [accounts, selectedAccountId],
  );

  const filteredAccounts = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return accounts;
    return accounts.filter((account) => account.name.toLowerCase().includes(term));
  }, [accounts, search]);

  const openCreateDialog = () => {
    setEditingAccount(null);
    setNameInput("");
    setEmailInput("");
    setActiveInput(true);
    setSaveError(null);
    setDialogOpen(true);
  };

  const openEditDialog = (account: AccountAdminDto) => {
    setEditingAccount(account);
    setNameInput(account.name);
    setEmailInput(account.contactEmail ?? "");
    setActiveInput(account.active);
    setSaveError(null);
    setDialogOpen(true);
  };

  const saveAccount = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!nameInput.trim()) {
      setSaveError("Account name is required.");
      return;
    }

    setIsSaving(true);
    setSaveError(null);

    const payload = {
      name: nameInput.trim(),
      contactEmail: emailInput.trim() || null,
      active: activeInput,
    };

    try {
      const res = editingAccount
        ? await authFetch(`/admin/accounts/${editingAccount.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await authFetch("/admin/accounts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: payload.name,
              contactEmail: payload.contactEmail,
            }),
          });

      const body = (await res.json().catch(() => null)) as unknown;
      if (!res.ok) {
        throw new Error(parseError(body, "Unable to save account."));
      }

      setDialogOpen(false);
      await loadAccounts();
      if (editingAccount) {
        setSelectedAccountId(editingAccount.id);
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Unable to save account.");
    } finally {
      setIsSaving(false);
    }
  };

  const recordPayment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedAccountId) return;

    const amount = Number.parseFloat(paymentAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setPaymentError("Enter a payment amount greater than zero.");
      return;
    }

    setPaymentSaving(true);
    setPaymentError(null);

    try {
      const res = await authFetch(`/admin/accounts/${selectedAccountId}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount,
          note: paymentNote.trim() || undefined,
        }),
      });

      const body = (await res.json().catch(() => null)) as AccountBalanceDto | unknown;
      if (!res.ok || !body) {
        throw new Error(parseError(body, "Unable to record payment."));
      }

      setBalance(body as AccountBalanceDto);
      setPaymentAmount("");
      setPaymentNote("");
      await loadAccounts();
    } catch (err) {
      setPaymentError(err instanceof Error ? err.message : "Unable to record payment.");
    } finally {
      setPaymentSaving(false);
    }
  };

  if (authLoading || !isAuthenticated || !user?.role?.toUpperCase().includes("ADMIN")) {
    return null;
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="hidden md:block">Admin</BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage>Accounts</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>

        <div className="flex flex-1 flex-col gap-4 p-4 pt-0 lg:grid lg:grid-cols-[1fr_1fr]">
          <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">Accounts</h2>
              <Button size="sm" onClick={openCreateDialog}>Create Account</Button>
            </div>

            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search accounts"
              className="mb-3"
            />

            {accountsError && (
              <div className="mb-3 rounded-md border border-rose-300 bg-rose-50 p-2 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
                {accountsError}
              </div>
            )}

            {accountsLoading ? (
              <p className="text-sm text-muted-foreground">Loading accounts...</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Active</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAccounts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">No accounts found.</TableCell>
                    </TableRow>
                  ) : (
                    filteredAccounts.map((account) => (
                      <TableRow
                        key={account.id}
                        className={selectedAccountId === account.id ? "bg-slate-100/80 dark:bg-slate-800/70" : ""}
                      >
                        <TableCell>
                          <button
                            type="button"
                            onClick={() => setSelectedAccountId(account.id)}
                            className="text-left font-medium text-blue-700 hover:underline dark:text-blue-300"
                          >
                            {account.name}
                          </button>
                        </TableCell>
                        <TableCell>{account.contactEmail || "-"}</TableCell>
                        <TableCell>{account.active ? "Yes" : "No"}</TableCell>
                        <TableCell>
                          <Button size="sm" variant="outline" onClick={() => openEditDialog(account)}>Edit</Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-lg font-semibold">Account Detail</h2>
            {!selectedAccount ? (
              <p className="mt-2 text-sm text-muted-foreground">Select an account to view balance and record payments.</p>
            ) : (
              <>
                <div className="mt-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  <p className="font-medium">{selectedAccount.name}</p>
                  <p className="text-sm text-muted-foreground">{selectedAccount.contactEmail || "No email"}</p>
                  <p className="text-sm text-muted-foreground">Status: {selectedAccount.active ? "Active" : "Inactive"}</p>
                </div>

                {balanceError && (
                  <div className="mt-3 rounded-md border border-rose-300 bg-rose-50 p-2 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
                    {balanceError}
                  </div>
                )}

                {balanceLoading ? (
                  <p className="mt-3 text-sm text-muted-foreground">Loading balance...</p>
                ) : balance ? (
                  <div className="mt-3 grid gap-2 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
                    <p>Total Charged: {formatZarCurrency(balance.totalCharged)}</p>
                    <p>Total Reversed: {formatZarCurrency(balance.totalReversed)}</p>
                    <p>Total Paid: {formatZarCurrency(balance.totalPaid)}</p>
                    <p className="font-semibold">Outstanding: {formatZarCurrency(balance.outstandingBalance)}</p>
                  </div>
                ) : null}

                <form onSubmit={recordPayment} className="mt-4 space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  <h3 className="font-medium">Record Payment</h3>

                  <div>
                    <Label htmlFor="payment-amount">Amount</Label>
                    <Input
                      id="payment-amount"
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={paymentAmount}
                      onChange={(event) => {
                        setPaymentAmount(event.target.value);
                        setPaymentError(null);
                      }}
                    />
                  </div>

                  <div>
                    <Label htmlFor="payment-note">Note (optional)</Label>
                    <Input
                      id="payment-note"
                      value={paymentNote}
                      onChange={(event) => setPaymentNote(event.target.value)}
                    />
                  </div>

                  {paymentError && <p className="text-sm text-rose-600 dark:text-rose-300">{paymentError}</p>}

                  <Button type="submit" disabled={paymentSaving}>
                    {paymentSaving ? "Recording..." : "Record Payment"}
                  </Button>
                </form>
              </>
            )}
          </section>
        </div>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingAccount ? "Edit Account" : "Create Account"}</DialogTitle>
            </DialogHeader>

            <form onSubmit={saveAccount} className="space-y-3">
              <div>
                <Label htmlFor="account-name">Name</Label>
                <Input id="account-name" value={nameInput} onChange={(event) => setNameInput(event.target.value)} />
              </div>

              <div>
                <Label htmlFor="account-email">Contact Email</Label>
                <Input
                  id="account-email"
                  value={emailInput}
                  onChange={(event) => setEmailInput(event.target.value)}
                />
              </div>

              {editingAccount && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="account-active"
                    checked={activeInput}
                    onCheckedChange={(value) => setActiveInput(Boolean(value))}
                  />
                  <Label htmlFor="account-active">Active</Label>
                </div>
              )}

              {saveError && <p className="text-sm text-rose-600 dark:text-rose-300">{saveError}</p>}

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isSaving}>
                  {isSaving ? "Saving..." : "Save"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </SidebarInset>
    </SidebarProvider>
  );
}
