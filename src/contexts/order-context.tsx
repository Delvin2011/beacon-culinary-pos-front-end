"use client";

import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/hooks/use-auth";

export interface Category {
  id: string;
  name: string;
}

export interface Product {
  id: number;
  name: string;
  description?: string;
  categoryId: string;
  variants: ProductVariant[];
}

export interface ProductVariant {
  id: number;
  variantName: string;
  price: number;
}

export interface CartItem {
  cartItemId: string;
  productId: number;
  categoryId: string;
  name: string;
  description?: string;
  variantId: number;
  variantName: string;
  price: number;
  quantity: number;
}

interface OrderContextValue {
  categories: Category[];
  products: Product[];
  activeCategoryId: string | null;
  isCategoriesLoading: boolean;
  isProductsLoading: boolean;
  error: string | null;
  cartItems: CartItem[];
  subTotal: number;
  vat: number;
  totalAmount: number;
  setActiveCategoryId: (categoryId: string) => void;
  addToCart: (product: Product, variant: ProductVariant, quantityToAdd?: number) => void;
  updateCartQuantity: (cartItemId: string, quantity: number) => void;
  removeFromCart: (cartItemId: string) => void;
  clearCart: () => void;
  reloadCatalog: () => Promise<void>;
}

const OrderContext = createContext<OrderContextValue | undefined>(undefined);

function parseErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;

  const data = payload as Record<string, unknown>;
  const message = data.message;

  if (typeof message === "string" && message.trim().length > 0) {
    return message;
  }

  const error = data.error;
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  return fallback;
}

async function parseJsonResponse<T>(response: Response): Promise<T | null> {
  return (await response.json().catch(() => null)) as T | null;
}

interface MenuItemVariantDto {
  id?: number;
  name?: string;
  price?: number;
}

interface MenuItemDto {
  id?: number;
  name?: string;
  description?: string;
  categoryId?: string;
  variants?: MenuItemVariantDto[];
}

interface MenuCategorySectionDto {
  id?: string;
  name?: string;
  items?: MenuItemDto[];
}

interface MenuResponseDto {
  categories?: MenuCategorySectionDto[];
}

export function OrderProvider({ children }: { children: ReactNode }) {
  const { authFetch } = useAuth();

  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [isCategoriesLoading, setIsCategoriesLoading] = useState(false);
  const [isProductsLoading, setIsProductsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);

  const loadCatalog = useCallback(async () => {
    setIsCategoriesLoading(true);
    setIsProductsLoading(true);
    setError(null);

    try {
      const response = await authFetch("/menu");
      const data = await parseJsonResponse<MenuResponseDto>(response);

      if (!response.ok) {
        throw new Error(parseErrorMessage(data, "Failed to load menu."));
      }

      const sections = Array.isArray(data?.categories) ? data.categories : [];

      const nextCategories = sections
        .filter((section): section is Required<Pick<MenuCategorySectionDto, "id" | "name">> => {
          return typeof section.id === "string" && typeof section.name === "string";
        })
        .map((section) => ({
          id: section.id,
          name: section.name,
        }));

      const nextProducts = sections.reduce<Product[]>((acc, section) => {
        for (const item of section.items ?? []) {
          if (typeof item.id !== "number" || typeof item.name !== "string") {
            continue;
          }

          const variants = (item.variants ?? [])
            .filter(
              (variant): variant is Required<Pick<MenuItemVariantDto, "id" | "name" | "price">> => {
                return (
                  typeof variant.id === "number" &&
                  typeof variant.name === "string" &&
                  typeof variant.price === "number"
                );
              }
            )
            .map((variant) => ({
              id: variant.id,
              variantName: variant.name,
              price: variant.price,
            }));

          if (variants.length === 0) {
            continue;
          }

          acc.push({
            id: item.id,
            name: item.name,
            description: item.description,
            categoryId:
              typeof item.categoryId === "string" ? item.categoryId : (section.id ?? ""),
            variants,
          });
        }

        return acc;
      }, []);

      setCategories(nextCategories);
      setProducts(nextProducts);
      setActiveCategoryId(nextCategories[0]?.id ?? null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to load menu.";
      setCategories([]);
      setProducts([]);
      setError(message);
    } finally {
      setIsCategoriesLoading(false);
      setIsProductsLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const addToCart = useCallback((product: Product, variant: ProductVariant, quantityToAdd = 1) => {
    setCartItems((prev) => {
      const normalizedQuantity = Math.max(1, quantityToAdd);
      const cartItemId = `${product.id}:${variant.id}`;
      const existing = prev.find((item) => item.cartItemId === cartItemId);

      if (existing) {
        return prev.map((item) =>
          item.cartItemId === cartItemId
            ? { ...item, quantity: item.quantity + normalizedQuantity }
            : item
        );
      }

      return [
        ...prev,
        {
          cartItemId,
          productId: product.id,
          categoryId: product.categoryId,
          name: product.name,
          description: product.description,
          variantId: variant.id,
          variantName: variant.variantName,
          price: variant.price,
          quantity: normalizedQuantity,
        },
      ];
    });
  }, []);

  const updateCartQuantity = useCallback((cartItemId: string, quantity: number) => {
    const safeQuantity = Number.isNaN(quantity) ? 0 : quantity;
    setCartItems((prev) =>
      prev.map((item) =>
        item.cartItemId === cartItemId
          ? { ...item, quantity: Math.max(0, safeQuantity) }
          : item
      )
    );
  }, []);

  const removeFromCart = useCallback((cartItemId: string) => {
    setCartItems((prev) => prev.filter((item) => item.cartItemId !== cartItemId));
  }, []);

  const clearCart = useCallback(() => {
    setCartItems([]);
  }, []);

  const reloadCatalog = useCallback(async () => {
    await loadCatalog();
  }, [loadCatalog]);

  const subTotal = useMemo(
    () => cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0),
    [cartItems]
  );
  const vat = subTotal * 0.15;
  const totalAmount = subTotal + vat;

  const value = useMemo<OrderContextValue>(
    () => ({
      categories,
      products,
      activeCategoryId,
      isCategoriesLoading,
      isProductsLoading,
      error,
      cartItems,
      subTotal,
      vat,
      totalAmount,
      setActiveCategoryId,
      addToCart,
      updateCartQuantity,
      removeFromCart,
      clearCart,
      reloadCatalog,
    }),
    [
      categories,
      products,
      activeCategoryId,
      isCategoriesLoading,
      isProductsLoading,
      error,
      cartItems,
      subTotal,
      vat,
      totalAmount,
      addToCart,
      updateCartQuantity,
      removeFromCart,
      clearCart,
      reloadCatalog,
    ]
  );

  return <OrderContext.Provider value={value}>{children}</OrderContext.Provider>;
}

export { OrderContext };
