"use client";

import { useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { OrderProvider } from "@/contexts/order-context";
import CustomerOrder from "@/components/customer-orders/order-creation";
import { Payment } from "@/components/customer-orders/order-payments";

export default function Page() {
  const [breadcrumbPath, setBreadcrumbPath] = useState(["Customer", "CreateOrder"]);
  const [currentPage, setCurrentPage] = useState("CustomerOrder");

  const navigateToPayment = () => {
    setBreadcrumbPath([...breadcrumbPath, "Payment"]);
    setCurrentPage("Payment");
  };

  return (
    <OrderProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
            <div className="flex items-center gap-2 px-4">
              <SidebarTrigger className="-ml-1" />
              <Separator orientation="vertical" className="mr-2 h-4" />
              <Breadcrumb>
                <BreadcrumbList>
                  {breadcrumbPath.map((crumb, index) => (
                    <BreadcrumbItem key={index}>
                      {index < breadcrumbPath.length - 1 ? (
                        <>
                          <BreadcrumbPage className="hidden md:block">{crumb}</BreadcrumbPage>
                          <BreadcrumbSeparator className="hidden md:block" />
                        </>
                      ) : (
                        <BreadcrumbPage>{crumb}</BreadcrumbPage>
                      )}
                    </BreadcrumbItem>
                  ))}
                </BreadcrumbList>
              </Breadcrumb>
            </div>
          </header>
          <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
            {currentPage === "CustomerOrder" && <CustomerOrder onCheckout={navigateToPayment} />}
            {currentPage === "Payment" && <Payment />}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </OrderProvider>
  );
}
